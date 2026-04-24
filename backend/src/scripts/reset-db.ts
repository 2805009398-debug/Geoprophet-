import fs from 'node:fs';
import { runtimePaths } from '../config';

if (fs.existsSync(runtimePaths.dbPath)) {
  fs.rmSync(runtimePaths.dbPath, { force: true });
  console.log('Database removed:', runtimePaths.dbPath);
} else {
  console.log('Database file not found, nothing to remove.');
}

