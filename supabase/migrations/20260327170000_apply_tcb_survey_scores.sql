begin;

with staged_scores (
  player_id,
  shooting,
  driving,
  assisting,
  man_defense,
  help_defense,
  shot_blocking,
  playmaking,
  rebounding,
  transition
) as (
  values
  (1, 3.2, 3.5, 3.7, 3.8, 3.5, 2.8, 4.2, 3.0, 4.3),
  (2, 3.5, 4.8, 3.5, 5.0, 4.7, 4.0, 4.8, 4.3, 4.8),
  (3, 4.5, 4.0, 4.0, 3.3, 2.8, 2.3, 3.5, 2.5, 3.3),
  (4, 3.2, 3.0, 3.3, 3.3, 3.2, 2.7, 3.8, 3.0, 3.7),
  (5, 5.0, 4.3, 3.7, 2.7, 2.5, 1.8, 3.2, 2.2, 3.0),
  (6, 5.0, 4.8, 3.3, 2.7, 2.5, 1.8, 3.0, 2.0, 3.3),
  (7, 4.0, 3.8, 3.0, 3.4, 3.0, 2.8, 3.4, 3.8, 3.4),
  (8, 4.4, 3.8, 2.8, 2.4, 2.4, 1.6, 3.6, 2.2, 3.6),
  (9, 1.3, 1.0, 1.2, 1.7, 1.5, 1.5, 1.8, 1.3, 1.5),
  (10, 3.2, 2.0, 3.0, 2.3, 2.7, 2.3, 2.2, 2.2, 1.3),
  (11, 3.5, 1.8, 2.8, 2.8, 2.7, 2.3, 2.8, 2.7, 2.5),
  (12, 2.0, 2.7, 2.5, 3.5, 3.0, 3.5, 4.0, 3.8, 3.8),
  (13, 2.7, 3.0, 2.2, 2.8, 2.7, 3.2, 3.5, 3.7, 3.7),
  (14, 2.2, 3.2, 2.5, 3.8, 3.5, 4.2, 3.2, 4.3, 3.2),
  (15, 1.3, 3.7, 2.7, 4.7, 4.7, 4.7, 3.7, 4.7, 3.3),
  (16, 1.7, 3.2, 2.8, 4.2, 3.8, 4.3, 3.8, 4.8, 4.0),
  (17, 1.0, 2.0, 1.7, 2.7, 3.8, 4.3, 2.7, 4.3, 1.8),
  (18, 2.8, 2.2, 2.8, 2.7, 3.2, 3.3, 2.3, 3.8, 1.8),
  (19, 4.0, 4.5, 4.5, 3.8, 4.5, 4.3, 3.5, 4.7, 3.3)
)
update public.players as p
set
  shooting = s.shooting,
  driving = s.driving,
  assisting = s.assisting,
  man_defense = s.man_defense,
  help_defense = s.help_defense,
  shot_blocking = s.shot_blocking,
  playmaking = s.playmaking,
  rebounding = s.rebounding,
  transition = s.transition,
  updated_at = now()
from staged_scores as s
where p.id = s.player_id
  and p.run_id = '11111111-1111-4111-8111-111111111111'::uuid;

commit;
