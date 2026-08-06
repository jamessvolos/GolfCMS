-- The second rating axis. trapSize asks whether the obvious aim is wrong;
-- these ask what being wrong costs, and which side it costs on. A green
-- with water down one flank can have a trap of exactly zero and still be
-- the most important shot on the course — the shipped library taught three
-- of those as free PERFECTs.
ALTER TABLE "Puzzle" ADD COLUMN "consequence" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Puzzle" ADD COLUMN "asymmetry" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Puzzle" ADD COLUMN "holds" TEXT NOT NULL DEFAULT '';
