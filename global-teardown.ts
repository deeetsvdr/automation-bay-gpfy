import fs from 'fs';
import path from 'path';
import { Utitilies } from "@shared/utils/utilities";

export default async function globalTeardown() {
  const utility = new Utitilies();
  utility.queue.setFile('jsonQueue.json');

  const authFiles = [
    path.resolve('playwright/.auth/storageState.json'),
    path.resolve('playwright/.auth/token.txt'),
    path.resolve('playwright/.auth/roles'),
    path.resolve('playwright/scheduleManager.queue'),
  ];

  //utility.queue.clear();

  for (const filePath of authFiles) {
    if (fs.existsSync(filePath)) {
      try {
        if (fs.lstatSync(filePath).isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
        console.log(`Deleted: ${filePath}`);
      } catch (error) {
        console.error(`Failed to delete ${filePath}:`, error);
      }
    }
  }
}
