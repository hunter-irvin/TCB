alter table public.players
  alter column shooting type numeric(3,1) using shooting::numeric(3,1),
  alter column driving type numeric(3,1) using driving::numeric(3,1),
  alter column assisting type numeric(3,1) using assisting::numeric(3,1),
  alter column man_defense type numeric(3,1) using man_defense::numeric(3,1),
  alter column help_defense type numeric(3,1) using help_defense::numeric(3,1),
  alter column shot_blocking type numeric(3,1) using shot_blocking::numeric(3,1),
  alter column playmaking type numeric(3,1) using playmaking::numeric(3,1),
  alter column rebounding type numeric(3,1) using rebounding::numeric(3,1),
  alter column transition type numeric(3,1) using transition::numeric(3,1);
