-- Ratings are Monte Carlo estimates. Store the error bar alongside the
-- estimate so the serving gate can read `trapSize - 2*trapSe` instead of
-- trusting a point estimate that is noisiest exactly where the rating
-- curve is steepest.
ALTER TABLE "Puzzle" ADD COLUMN "trapSe" REAL NOT NULL DEFAULT 0;
