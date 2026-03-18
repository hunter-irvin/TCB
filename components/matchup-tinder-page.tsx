"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AppShell } from "@/components/app-shell";
import type {
  MatchupTinderMatchup,
  MatchupTinderMode,
  MatchupTinderResult
} from "@/lib/matchup-tinder";

type MatchupTinderNextResponse = {
  matchup?: MatchupTinderMatchup;
  error?: string;
};

type MatchupTinderRespondResponse = {
  ok?: boolean;
  nextMatchup?: MatchupTinderMatchup | null;
  error?: string;
};

type MatchupTinderPreparedRound = {
  nextMatchup: MatchupTinderMatchup;
  showReadyToPlayModal: boolean;
};

type MatchupTinderPreparedSkipRound = {
  nextMatchup: MatchupTinderMatchup;
};

type DragOffset = {
  x: number;
  y: number;
};

type ResolvedChoice = MatchupTinderResult | "skip" | null;

const DRAG_THRESHOLD_X = 92;
const DRAG_THRESHOLD_Y = 84;
const OFFENSE_VIDEO_SOURCES = [
  "/matchup-tinder/offense-demo.mp4",
  "/matchup-tinder/offense-demo-2.mp4",
  "/matchup-tinder/offense-demo-3.mp4",
  "/matchup-tinder/offense-demo-4.mp4",
  "/matchup-tinder/offense-demo-5.mp4"
] as const;
const DEFENSE_VIDEO_SOURCES = [
  "/matchup-tinder/defense-demo.mp4",
  "/matchup-tinder/defense-demo-2.mp4",
  "/matchup-tinder/defense-demo-3.mp4",
  "/matchup-tinder/defense-demo-4.mp4",
  "/matchup-tinder/defense-demo-5.mp4",
  "/matchup-tinder/defense-demo-6.mp4"
] as const;
const BALL_TARGET_OFFSETS: Record<MatchupTinderResult, DragOffset> = {
  offense_wins: { x: -148, y: 0 },
  defense_wins: { x: 148, y: 0 },
  good_matchup: { x: 0, y: -120 }
};
const MATCHUP_TINDER_INSTRUCTIONS =
  "If it's not a good matchup, drag left or right to indicate who would win. In the future, good matchup data will be used to generate more fair teams.";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function getTargetFromOffset(offset: DragOffset): MatchupTinderResult | null {
  if (offset.y <= -DRAG_THRESHOLD_Y && Math.abs(offset.y) >= Math.abs(offset.x) * 0.9) {
    return "good_matchup";
  }

  if (offset.x <= -DRAG_THRESHOLD_X) {
    return "offense_wins";
  }

  if (offset.x >= DRAG_THRESHOLD_X) {
    return "defense_wins";
  }

  return null;
}

function getPlayerNameClassName(name: string) {
  const baseClassName = "matchup-tinder-player-name";

  if (name.length <= 14) {
    return baseClassName;
  }

  if (name.length <= 18) {
    return `${baseClassName} compact`;
  }

  if (name.length <= 24) {
    return `${baseClassName} compressed`;
  }

  return `${baseClassName} ultra-compressed`;
}

export function MatchupTinderPage() {
  const [mode, setMode] = useState<MatchupTinderMode>("test");
  const [matchup, setMatchup] = useState<MatchupTinderMatchup | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "resolving" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<DragOffset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [activeTarget, setActiveTarget] = useState<MatchupTinderResult | null>(null);
  const [resolvedChoice, setResolvedChoice] = useState<ResolvedChoice>(null);
  const [flashTransition, setFlashTransition] = useState(false);
  const [selectedTargetOffset, setSelectedTargetOffset] = useState<DragOffset>({ x: 0, y: 0 });
  const [testCompletedRounds, setTestCompletedRounds] = useState(0);
  const [showReadyToPlayModal, setShowReadyToPlayModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(true);
  const [roundSeed, setRoundSeed] = useState(0);
  const seenMatchupKeysRef = useRef(new Set<string>());
  const dragOffsetRef = useRef<DragOffset>({ x: 0, y: 0 });
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const ballRef = useRef<HTMLButtonElement | null>(null);
  const ballLaneRef = useRef<HTMLDivElement | null>(null);
  const offenseTargetRef = useRef<HTMLButtonElement | null>(null);
  const defenseTargetRef = useRef<HTMLButtonElement | null>(null);
  const goodMatchupTargetRef = useRef<HTMLButtonElement | null>(null);
  const offenseVideoRef = useRef<HTMLVideoElement | null>(null);
  const defenseVideoRef = useRef<HTMLVideoElement | null>(null);

  const currentMatchupKey = matchup?.matchupKey ?? null;
  const busy = status === "loading" || status === "resolving" || showReadyToPlayModal;

  const resetMotionState = useCallback(() => {
    setDragging(false);
    setDragOffset({ x: 0, y: 0 });
    dragOffsetRef.current = { x: 0, y: 0 };
    setActiveTarget(null);
    setResolvedChoice(null);
    setFlashTransition(false);
    setSelectedTargetOffset({ x: 0, y: 0 });
    dragStartRef.current = null;
    pointerIdRef.current = null;
  }, []);

  const applyNextMatchup = useCallback(
    (nextMatchup: MatchupTinderMatchup) => {
      resetMotionState();
      startTransition(() => {
        setMatchup(nextMatchup);
        setRoundSeed((current) => current + 1);
      });
      setStatus("ready");
      setError(null);
    },
    [resetMotionState]
  );

  const loadNextMatchup = useCallback(async (nextMode: MatchupTinderMode, excludedKeys: Iterable<string>) => {
    const params = new URLSearchParams();
    params.set("mode", nextMode);

    for (const key of excludedKeys) {
      params.append("exclude", key);
    }

    const response = await fetch(`/api/matchup-tinder/next?${params.toString()}`, {
      method: "GET",
      cache: "no-store"
    });
    const payload = (await response.json()) as MatchupTinderNextResponse;

    if (!response.ok || !payload.matchup) {
      throw new Error(payload.error ?? "Unable to load a matchup right now.");
    }

    return payload.matchup;
  }, []);

  const requestNextMatchup = useCallback(
    async (nextMode: MatchupTinderMode, excludedKeys: Iterable<string>) => {
      setStatus("loading");
      setError(null);

      try {
        const nextMatchup = await loadNextMatchup(nextMode, excludedKeys);
        applyNextMatchup(nextMatchup);
      } catch (requestError) {
        setStatus("error");
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load a matchup right now."
        );
      }
    },
    [applyNextMatchup, loadNextMatchup]
  );

  useEffect(() => {
    seenMatchupKeysRef.current = new Set();
    setMatchup(null);
    resetMotionState();
    void requestNextMatchup("test", seenMatchupKeysRef.current);
  }, [requestNextMatchup, resetMotionState]);

  const handleModeChange = (nextMode: MatchupTinderMode) => {
    if (busy || nextMode === mode) {
      return;
    }

    setShowReadyToPlayModal(false);
    setTestCompletedRounds(0);
    setMode(nextMode);
  };

  const ensureVideoPlayback = useCallback((video: HTMLVideoElement | null) => {
    if (!video) {
      return () => {};
    }

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");

    const playVideo = () => {
      const playPromise = video.play();
      if (playPromise) {
        void playPromise.catch(() => {});
      }
    };

    playVideo();
    const timeoutId = window.setTimeout(playVideo, 180);
    video.addEventListener("loadeddata", playVideo);
    video.addEventListener("canplay", playVideo);

    return () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener("loadeddata", playVideo);
      video.removeEventListener("canplay", playVideo);
    };
  }, []);

  useEffect(() => {
    const cleanupOffense = ensureVideoPlayback(offenseVideoRef.current);
    const cleanupDefense = ensureVideoPlayback(defenseVideoRef.current);
    const animationFrameId = window.requestAnimationFrame(() => {
      const replayOffense = offenseVideoRef.current?.play();
      if (replayOffense) {
        void replayOffense.catch(() => {});
      }

      const replayDefense = defenseVideoRef.current?.play();
      if (replayDefense) {
        void replayDefense.catch(() => {});
      }
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      cleanupOffense();
      cleanupDefense();
    };
  }, [ensureVideoPlayback, roundSeed, showInfoModal]);

  const getCompletionOffset = useCallback((choice: MatchupTinderResult): DragOffset => {
    const ballLane = ballLaneRef.current;
    const target =
      choice === "offense_wins"
        ? offenseTargetRef.current
        : choice === "defense_wins"
          ? defenseTargetRef.current
          : goodMatchupTargetRef.current;

    if (!ballLane || !target) {
      return BALL_TARGET_OFFSETS[choice];
    }

    const ballLaneRect = ballLane.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    return {
      x: clamp(
        targetRect.left + targetRect.width / 2 - (ballLaneRect.left + ballLaneRect.width / 2),
        -220,
        220
      ),
      y: clamp(
        targetRect.top + targetRect.height / 2 - (ballLaneRect.top + ballLaneRect.height / 2),
        -220,
        120
      )
    };
  }, []);

  const getSelectedTargetOffset = useCallback((choice: MatchupTinderResult): DragOffset => {
    const stage = stageRef.current;
    const target =
      choice === "offense_wins"
        ? offenseTargetRef.current
        : choice === "defense_wins"
          ? defenseTargetRef.current
          : goodMatchupTargetRef.current;

    if (!stage || !target) {
      return { x: 0, y: 0 };
    }

    const stageRect = stage.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    return {
      x: clamp(
        stageRect.left + stageRect.width / 2 - (targetRect.left + targetRect.width / 2),
        -360,
        360
      ),
      y: clamp(
        stageRect.top + stageRect.height / 2 - (targetRect.top + targetRect.height / 2),
        -280,
        280
      )
    };
  }, []);

  const finishSkip = useCallback(async (): Promise<MatchupTinderPreparedSkipRound> => {
    if (!currentMatchupKey) {
      throw new Error("Unable to load the next matchup right now.");
    }

    seenMatchupKeysRef.current.add(currentMatchupKey);
    const nextMatchup = await loadNextMatchup(mode, seenMatchupKeysRef.current);

    return { nextMatchup };
  }, [currentMatchupKey, loadNextMatchup, mode]);

  const finishResponse = useCallback(
    async (choice: MatchupTinderResult): Promise<MatchupTinderPreparedRound> => {
      if (!matchup) {
        throw new Error("Unable to record your selection.");
      }

      const response = await fetch("/api/matchup-tinder/respond", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          offensePlayerId: matchup.offensePlayer.id,
          defensePlayerId: matchup.defensePlayer.id,
          result: choice,
          mode,
          seenMatchupKeys: [...seenMatchupKeysRef.current, matchup.matchupKey]
        })
      });
      const payload = (await response.json()) as MatchupTinderRespondResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Unable to record your selection.");
      }

      seenMatchupKeysRef.current.add(matchup.matchupKey);

      let showReadyToPlayModal = false;
      if (mode === "test") {
        const nextCount = testCompletedRounds + 1;
        showReadyToPlayModal = nextCount >= 3;
        setTestCompletedRounds(showReadyToPlayModal ? 0 : nextCount);
      }

      const nextMatchup =
        payload.nextMatchup ?? (await loadNextMatchup(mode, seenMatchupKeysRef.current));

      return {
        nextMatchup,
        showReadyToPlayModal
      };
    },
    [loadNextMatchup, matchup, mode, testCompletedRounds]
  );

  const handleKeepTesting = () => {
    setShowReadyToPlayModal(false);
  };

  const handlePlayMode = () => {
    setShowReadyToPlayModal(false);
    setTestCompletedRounds(0);
    setMode("play");
  };

  const resolveChoice = useCallback(
    async (choice: ResolvedChoice) => {
      if (!matchup || busy || !choice) {
        return;
      }

      setStatus("resolving");
      setResolvedChoice(choice);
      setDragging(false);

      if (choice === "skip") {
        setDragOffset({ x: 0, y: 0 });
        dragOffsetRef.current = { x: 0, y: 0 };
      } else {
        setActiveTarget(choice);
        setSelectedTargetOffset(getSelectedTargetOffset(choice));
        const completionOffset = getCompletionOffset(choice);
        setDragOffset(completionOffset);
        dragOffsetRef.current = completionOffset;
      }

      const preparedRoundPromise =
        choice === "skip" ? finishSkip() : finishResponse(choice);

      if (choice === "skip") {
        setFlashTransition(true);
        await Promise.all([preparedRoundPromise, new Promise((resolve) => setTimeout(resolve, 220))]);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setFlashTransition(true);
        await Promise.all([preparedRoundPromise, new Promise((resolve) => setTimeout(resolve, 220))]);
      }

      try {
        const preparedRound = await preparedRoundPromise;
        applyNextMatchup(preparedRound.nextMatchup);
        if (choice !== "skip" && "showReadyToPlayModal" in preparedRound && preparedRound.showReadyToPlayModal) {
          setShowReadyToPlayModal(true);
        }
      } catch (submissionError) {
        resetMotionState();
        setStatus("error");
        setError(
          submissionError instanceof Error
            ? submissionError.message
            : "Unable to record your selection."
        );
        setMatchup(matchup);
      }
    },
    [
      applyNextMatchup,
      busy,
      finishResponse,
      finishSkip,
      getCompletionOffset,
      getSelectedTargetOffset,
      matchup,
      resetMotionState
    ]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!matchup || busy) {
      return;
    }

    pointerIdRef.current = event.pointerId;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
    setActiveTarget(null);
    ballRef.current?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging || pointerIdRef.current !== event.pointerId || !dragStartRef.current) {
      return;
    }

    const nextOffset = {
      x: clamp(event.clientX - dragStartRef.current.x, -128, 128),
      y: clamp(event.clientY - dragStartRef.current.y, -136, 56)
    };

    setDragOffset(nextOffset);
    dragOffsetRef.current = nextOffset;
    setActiveTarget(getTargetFromOffset(nextOffset));
  };

  const completePointerInteraction = async (event: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== event.pointerId) {
      return;
    }

    ballRef.current?.releasePointerCapture(event.pointerId);

    const target = getTargetFromOffset(dragOffsetRef.current);
    if (target) {
      await resolveChoice(target);
      return;
    }

    resetMotionState();
  };

  const stageClassName = useMemo(
    () =>
      [
        "matchup-tinder-stage",
        dragging ? "dragging" : "",
        status === "resolving" ? "resolving" : "",
        activeTarget ? `target-${activeTarget}` : "",
        resolvedChoice ? `choice-${resolvedChoice}` : ""
      ]
        .filter(Boolean)
        .join(" "),
    [activeTarget, dragging, resolvedChoice, status]
  );

  const shellClassName = useMemo(
    () =>
      [
        "panel",
        "matchup-tinder-shell",
        flashTransition ? "flash" : ""
      ]
        .filter(Boolean)
        .join(" "),
    [flashTransition]
  );

  const stageStyle = useMemo(
    () =>
      ({
        "--matchup-selected-shift-x": `${selectedTargetOffset.x}px`,
        "--matchup-selected-shift-y": `${selectedTargetOffset.y}px`
      }) as CSSProperties,
    [selectedTargetOffset.x, selectedTargetOffset.y]
  );

  const offenseVideoSource = useMemo(
    () => OFFENSE_VIDEO_SOURCES[Math.floor(Math.random() * OFFENSE_VIDEO_SOURCES.length)],
    [roundSeed]
  );
  const defenseVideoSource = useMemo(
    () => DEFENSE_VIDEO_SOURCES[Math.floor(Math.random() * DEFENSE_VIDEO_SOURCES.length)],
    [roundSeed]
  );

  return (
    <AppShell
      title="Matchup Tinder"
      copy={null}
      showNav={false}
      headerActions={
        <button
          type="button"
          className="matchup-tinder-info-button"
          onClick={() => setShowInfoModal(true)}
          aria-label="Show matchup tinder instructions"
        >
          i
        </button>
      }
      shellClassName="matchup-tinder-route-shell"
      frameClassName="matchup-tinder-route-frame"
      headerClassName="matchup-tinder-route-header"
    >
      <div className="matchup-tinder-page">
        <div className="matchup-tinder-toggle-block">
          <div className="matchup-tinder-toggle" role="tablist" aria-label="Matchup mode">
            {(["test", "play"] as MatchupTinderMode[]).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={mode === option}
                className={`matchup-tinder-toggle-button${mode === option ? " active" : ""}`}
                onClick={() => handleModeChange(option)}
                disabled={busy}
              >
                <span className="matchup-tinder-toggle-button-label">
                  {option === "test" ? "Test" : "Play"}
                </span>
                {option === "test" ? (
                  <span className="matchup-tinder-toggle-button-note">Answers not recorded</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <section className={shellClassName}>
          {error ? (
            <div className="matchup-tinder-error-card">
              <h2>Unable to continue right now</h2>
              <p>{error}</p>
              <button
                type="button"
                className="matchup-tinder-retry"
                onClick={() => void requestNextMatchup(mode, seenMatchupKeysRef.current)}
              >
                Try again
              </button>
            </div>
          ) : matchup ? (
            <div
              key={`${mode}-${matchup.matchupKey}-${roundSeed}`}
              ref={stageRef}
              className={stageClassName}
              style={stageStyle}
            >
              <button
                ref={goodMatchupTargetRef}
                type="button"
                className={`matchup-tinder-top-target${activeTarget === "good_matchup" ? " active" : ""}${resolvedChoice === "good_matchup" ? " resolved" : ""}`}
                onClick={() => void resolveChoice("good_matchup")}
                disabled={busy}
              >
                <span>Good Matchup</span>
              </button>

              <div className="matchup-tinder-lanes">
                <button
                  ref={offenseTargetRef}
                  type="button"
                  className={`matchup-tinder-lane offense${activeTarget === "offense_wins" ? " active" : ""}${resolvedChoice === "offense_wins" ? " resolved" : ""}`}
                  onClick={() => void resolveChoice("offense_wins")}
                  disabled={busy}
                >
                  <span className="matchup-tinder-role-tag">Offense</span>
                  <span className="matchup-tinder-media-frame" aria-hidden="true">
                    <video
                      ref={offenseVideoRef}
                      className="matchup-tinder-media"
                      src={offenseVideoSource}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      disablePictureInPicture
                    />
                  </span>
                  <span
                    className={getPlayerNameClassName(matchup.offensePlayer.name)}
                    title={matchup.offensePlayer.name}
                  >
                    {matchup.offensePlayer.name}
                  </span>
                </button>

                <div ref={ballLaneRef} className="matchup-tinder-ball-lane">
                  <div className="matchup-tinder-ball-shadow" />
                  <button
                    ref={ballRef}
                    type="button"
                    className={`matchup-tinder-ball${dragging ? " dragging" : ""}`}
                    style={{
                      transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`
                    }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={(event) => void completePointerInteraction(event)}
                    onPointerCancel={() => resetMotionState()}
                    disabled={busy}
                    aria-label="Drag basketball left for offense wins, right for defense wins, or up for good matchup"
                  >
                    <img
                      className="matchup-tinder-ball-image"
                      src="/matchup-tinder/basketball.png"
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                  </button>
                </div>

                <button
                  ref={defenseTargetRef}
                  type="button"
                  className={`matchup-tinder-lane defense${activeTarget === "defense_wins" ? " active" : ""}${resolvedChoice === "defense_wins" ? " resolved" : ""}`}
                  onClick={() => void resolveChoice("defense_wins")}
                  disabled={busy}
                >
                  <span className="matchup-tinder-role-tag">Defense</span>
                  <span className="matchup-tinder-media-frame" aria-hidden="true">
                    <video
                      ref={defenseVideoRef}
                      className="matchup-tinder-media"
                      src={defenseVideoSource}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      disablePictureInPicture
                    />
                  </span>
                  <span
                    className={getPlayerNameClassName(matchup.defensePlayer.name)}
                    title={matchup.defensePlayer.name}
                  >
                    {matchup.defensePlayer.name}
                  </span>
                </button>
              </div>

              <button
                type="button"
                className="matchup-tinder-skip"
                onClick={() => void resolveChoice("skip")}
                disabled={busy}
              >
                Skip
              </button>
            </div>
          ) : (
            <div className="matchup-tinder-loading-card">
              <div className="matchup-tinder-loading-ball" />
              <p>Loading matchup...</p>
            </div>
          )}
        </section>

        {showInfoModal ? (
          <div className="matchup-tinder-modal-backdrop" role="presentation">
            <div
              className="matchup-tinder-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="matchup-tinder-info-title"
              aria-describedby="matchup-tinder-info-copy"
            >
              <button
                type="button"
                className="matchup-tinder-modal-close"
                onClick={() => setShowInfoModal(false)}
                aria-label="Close instructions"
              >
                x
              </button>
              <h2 id="matchup-tinder-info-title">Matchup Tinder</h2>
              <p className="matchup-tinder-info-lead">Drag the ball up to indicate a good matchup</p>
              <div className="matchup-tinder-info-gesture" aria-hidden="true">
                <img
                  className="matchup-tinder-info-ball"
                  src="/matchup-tinder/basketball.png"
                  alt=""
                  draggable={false}
                />
              </div>
              <p id="matchup-tinder-info-copy">{MATCHUP_TINDER_INSTRUCTIONS}</p>
            </div>
          </div>
        ) : null}

        {showReadyToPlayModal ? (
          <div className="matchup-tinder-modal-backdrop" role="presentation">
            <div
              className="matchup-tinder-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="matchup-tinder-ready-title"
              aria-describedby="matchup-tinder-ready-caption"
            >
              <h2 id="matchup-tinder-ready-title">Ready to Play?</h2>
              <p id="matchup-tinder-ready-caption">In test mode, answers are not recorded</p>
              <div className="matchup-tinder-modal-actions">
                <button
                  type="button"
                  className="matchup-tinder-modal-button secondary"
                  onClick={handleKeepTesting}
                >
                  Keep Testing
                </button>
                <button
                  type="button"
                  className="matchup-tinder-modal-button primary"
                  onClick={handlePlayMode}
                >
                  Play
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
