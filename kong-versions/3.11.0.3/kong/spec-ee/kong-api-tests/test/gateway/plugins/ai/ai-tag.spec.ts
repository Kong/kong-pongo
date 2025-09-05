import fs from 'fs';
import path from 'path';
import { expect } from '@support';
import * as glob from "glob";

describe('@ai: AI test files must have @ai tag in describe', function () {
  const testDir = path.join(__dirname, '.');
  const files = glob.sync('ai-*.spec.ts', { cwd: testDir });

  files.forEach(file => {
    it(`"${file}" should have @ai tag in top-level describe`, function () {
      const content = fs.readFileSync(path.join(testDir, file), 'utf8');
      const describeMatch = content.match(/describe\s*\(\s*['"`](.*?)['"`]/);
      expect(
        describeMatch && describeMatch[1].includes('@ai'),
        `File ${file} does not have @ai tag in top-level describe`
      ).to.be.true;
    });
  });
});
