-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Hole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseName" TEXT NOT NULL,
    "holeNumber" INTEGER NOT NULL,
    "par" INTEGER NOT NULL,
    "yardage" INTEGER NOT NULL,
    "geojson" TEXT NOT NULL,
    "imageryCenter" TEXT NOT NULL,
    "groundPlan" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'traced'
);
INSERT INTO "new_Hole" ("courseName", "geojson", "groundPlan", "holeNumber", "id", "imageryCenter", "par", "yardage") SELECT "courseName", "geojson", "groundPlan", "holeNumber", "id", "imageryCenter", "par", "yardage" FROM "Hole";
DROP TABLE "Hole";
ALTER TABLE "new_Hole" RENAME TO "Hole";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

