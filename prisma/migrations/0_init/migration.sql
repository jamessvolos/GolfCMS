-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'local',
    "name" TEXT NOT NULL DEFAULT 'Player',
    "handicap" REAL NOT NULL DEFAULT 14,
    "clubSpeed" INTEGER NOT NULL DEFAULT 110,
    "shotShape" TEXT NOT NULL DEFAULT 'draw',
    "elo" INTEGER NOT NULL DEFAULT 1200,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedDay" TEXT,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Hole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseName" TEXT NOT NULL,
    "holeNumber" INTEGER NOT NULL,
    "par" INTEGER NOT NULL,
    "yardage" INTEGER NOT NULL,
    "geojson" TEXT NOT NULL,
    "imageryCenter" TEXT NOT NULL,
    "groundPlan" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Puzzle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "holeId" TEXT NOT NULL,
    "ballPosition" TEXT NOT NULL,
    "lie" TEXT NOT NULL,
    "pinPosition" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "rating" INTEGER NOT NULL DEFAULT 1000,
    "trapSize" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "Puzzle_holeId_fkey" FOREIGN KEY ("holeId") REFERENCES "Hole" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "puzzleId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "aimPoint" TEXT NOT NULL,
    "sgLoss" REAL NOT NULL,
    "band" TEXT NOT NULL,
    "eloDelta" INTEGER NOT NULL,
    "xpGained" INTEGER NOT NULL DEFAULT 0,
    "ratingAfter" INTEGER NOT NULL DEFAULT 1200,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attempt_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Attempt_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HeatmapCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "puzzleId" TEXT NOT NULL,
    "profileBucket" TEXT NOT NULL,
    "grid" TEXT NOT NULL,
    "optimalAim" TEXT NOT NULL,
    "optimalE" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HeatmapCache_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "HeatmapCache_puzzleId_profileBucket_key" ON "HeatmapCache"("puzzleId", "profileBucket");

