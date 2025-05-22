import { execCmd, TestSession, prepareForNut } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';
import { Connection, AuthInfo, Org } from '@salesforce/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FileExportResult } from '../../../src/commands/fileops/export.js'; // Adjust path as needed

type ContentVersionSetup = {
  Id: string;
  Extension: string;
  OriginalContent: string;
  Title: string;
};

async function setupContentVersions(
  conn: Connection,
  count: number,
  prefix: string
): Promise<ContentVersionSetup[]> {
  const recordsToReturn: ContentVersionSetup[] = [];
  for (let i = 0; i < count; i++) {
    const title = `${prefix}_File${i + 1}`;
    const fileExtension = 'txt';
    const originalContent = `This is dynamic content for ${title} created at ${new Date().toISOString()}`;
    const versionData = Buffer.from(originalContent).toString('base64'); // ContentVersion data must be base64

    const cv = {
      Title: title,
      PathOnClient: `${title}.${fileExtension}`,
      VersionData: versionData,
      Origin: 'H', // 'H' for Chatter File
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await conn.sobject('ContentVersion').create(cv);
    if (!result.success) {
      throw new Error(`Failed to create ContentVersion ${title}: ${JSON.stringify(result.errors)}`);
    }
    // Query for the ContentDocumentId as it's needed to make the file available to the org
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cvRecord: any = await conn.singleRecordQuery(`SELECT ContentDocumentId FROM ContentVersion WHERE Id = '${result.id}'`);

    recordsToReturn.push({
      Id: result.id,
      Extension: fileExtension,
      OriginalContent: originalContent,
      Title: title,
    });
  }
  return recordsToReturn;
}

describe('file export NUTs', () => {
  let session: TestSession;
  let conn: Connection;
  let orgUsername: string;
  let testArtifactsDir: string; // For CSVs and output files for each test

  before(async () => {
    // prepareForNut(); // May not be needed if devhubAuthStrategy is correctly set
    session = await TestSession.create({
      project: { name: 'FileOpsNutProject' }, // Creates a dummy project structure
      devhubAuthStrategy: 'AUTO', // Or 'ENVIRONMENT' if SFDX_AUTH_URL is set
      scratchOrgs: [
        {
          alias: 'default',
          config: 'config/project-scratch-def.json',
          duration: 1,
        },
      ],
    });

    const defaultOrg = session.orgs.get('default');
    if (!defaultOrg) {
      throw new Error('Default scratch org not found in test session');
    }
    conn = defaultOrg.getConnection();
    orgUsername = defaultOrg.username!;
  });

  after(async () => {
    await session?.clean();
  });

  beforeEach(async () => {
    // Create a unique directory for each test's artifacts within the session's tmpDir
    testArtifactsDir = path.join(session.tmpDir, `test_run_${Date.now()}`);
    await fs.mkdir(testArtifactsDir, { recursive: true });
  });

  // No specific afterEach needed if all artifacts are in testArtifactsDir which is inside session.tmpDir

  it('Scenario 1: Basic Export and File Verification (Small Batch)', async () => {
    const fileCount = 3;
    const testPrefix = 'BasicExport';
    const testFiles = await setupContentVersions(conn, fileCount, testPrefix);

    const csvFilename = 'input-small.csv';
    const csvFilePath = path.join(testArtifactsDir, csvFilename);
    const outputDir = path.join(testArtifactsDir, 'output-small');
    await fs.mkdir(outputDir, { recursive: true });

    let csvContent = 'ContentVersionId,FileExt\n'; // Header for CSV
    testFiles.forEach((f) => (csvContent += `${f.Id},${f.Extension}\n`));
    await fs.writeFile(csvFilePath, csvContent);

    const command = `fileops export --file ${csvFilePath} --output-dir ${outputDir} --target-org ${orgUsername} --ext-col-name FileExt --json`;
    const result = execCmd<FileExportResult>(command, { ensureExitCode: 0, cli: 'sf' });
    
    expect(result.jsonOutput?.status).to.equal(0);
    const jsonResponse = result.jsonOutput?.result;
    expect(jsonResponse?.successCount).to.equal(fileCount);
    expect(jsonResponse?.failureCount).to.equal(0);

    const downloadedFiles = await fs.readdir(outputDir);
    expect(downloadedFiles.length).to.equal(fileCount);

    for (const testFile of testFiles) {
      const expectedFilename = `${testFile.Id}.${testFile.Extension}`;
      expect(downloadedFiles).to.include(expectedFilename);
      const downloadedContent = await fs.readFile(path.join(outputDir, expectedFilename), 'utf-8');
      expect(downloadedContent).to.equal(testFile.OriginalContent);
    }
  });

  it('Scenario 2: Batching Logic (Large Batch - >25 records)', async () => {
    const fileCount = 28; // Test a number not an exact multiple of 25
    const testPrefix = 'LargeBatch';
    const testFiles = await setupContentVersions(conn, fileCount, testPrefix);

    const csvFilename = 'input-large.csv';
    const csvFilePath = path.join(testArtifactsDir, csvFilename);
    const outputDir = path.join(testArtifactsDir, 'output-large');
    await fs.mkdir(outputDir, { recursive: true });

    let csvContent = 'ContentVersionId,FileExt\n';
    testFiles.forEach((f) => (csvContent += `${f.Id},${f.Extension}\n`));
    await fs.writeFile(csvFilePath, csvContent);

    const command = `fileops export --file ${csvFilePath} --output-dir ${outputDir} --target-org ${orgUsername} --ext-col-name FileExt --json`;
    const result = execCmd<FileExportResult>(command, { ensureExitCode: 0, cli: 'sf' });

    expect(result.jsonOutput?.status).to.equal(0);
    const jsonResponse = result.jsonOutput?.result;
    expect(jsonResponse?.successCount).to.equal(fileCount);
    expect(jsonResponse?.failureCount).to.equal(0);

    const downloadedFiles = await fs.readdir(outputDir);
    expect(downloadedFiles.length).to.equal(fileCount);

    // Spot check one file for content
    if (fileCount > 0) {
      const testFileToCheck = testFiles[Math.floor(fileCount / 2)]; // Pick one from the middle
      const expectedFilename = `${testFileToCheck.Id}.${testFileToCheck.Extension}`;
      expect(downloadedFiles).to.include(expectedFilename);
      const downloadedContent = await fs.readFile(path.join(outputDir, expectedFilename), 'utf-8');
      expect(downloadedContent).to.equal(testFileToCheck.OriginalContent);
    }
  });

  it('Scenario 3: Error Handling in a Batch (Mixed Success/Failure)', async () => {
    const validFileCount = 3;
    const fakeFileCount = 2;
    const testPrefix = 'MixedBatch';
    const validTestFiles = await setupContentVersions(conn, validFileCount, testPrefix);
    const fakeTestFiles = [
      { Id: '000000000000000AAA', Extension: 'txt', OriginalContent: '' }, // Fake ID 1
      { Id: '111111111111111BBB', Extension: 'doc', OriginalContent: '' }, // Fake ID 2
    ];

    const allTestRecords = [...validTestFiles, ...fakeTestFiles];

    const csvFilename = 'input-mixed.csv';
    const csvFilePath = path.join(testArtifactsDir, csvFilename);
    const outputDir = path.join(testArtifactsDir, 'output-mixed');
    await fs.mkdir(outputDir, { recursive: true });

    let csvContent = 'ContentVersionId,FileExt\n';
    allTestRecords.forEach((f) => (csvContent += `${f.Id},${f.Extension}\n`));
    await fs.writeFile(csvFilePath, csvContent);

    const command = `fileops export --file ${csvFilePath} --output-dir ${outputDir} --target-org ${orgUsername} --ext-col-name FileExt --json`;
    const result = execCmd<FileExportResult>(command, { ensureExitCode: 0, cli: 'sf' }); // Command succeeds overall

    expect(result.jsonOutput?.status).to.equal(0);
    const jsonResponse = result.jsonOutput?.result;
    expect(jsonResponse?.successCount).to.equal(validFileCount);
    expect(jsonResponse?.failureCount).to.equal(fakeFileCount);

    // Verify successfully downloaded files
    const downloadedFiles = await fs.readdir(outputDir);
    expect(downloadedFiles.length).to.equal(validFileCount);
    for (const validFile of validTestFiles) {
      const expectedFilename = `${validFile.Id}.${validFile.Extension}`;
      expect(downloadedFiles).to.include(expectedFilename);
      const downloadedContent = await fs.readFile(path.join(outputDir, expectedFilename), 'utf-8');
      expect(downloadedContent).to.equal(validFile.OriginalContent);
    }

    // Verify error CSV creation and content
    // Error CSV is created in the current working directory of the command, which is session.dir.
    const sessionDirFiles = await fs.readdir(session.dir);
    const errorCsvFile = sessionDirFiles.find(file => file.startsWith('errors') && file.endsWith('.csv'));
    expect(errorCsvFile, 'Error CSV file not found in session directory').to.not.be.undefined;

    const errorCsvPath = path.join(session.dir, errorCsvFile!);
    const errorCsvContent = await fs.readFile(errorCsvPath, 'utf-8');

    for (const fakeFile of fakeTestFiles) {
      expect(errorCsvContent).to.include(fakeFile.Id);
      expect(errorCsvContent).to.include('Error in batch sub-request for ID');
      // Salesforce API might return 404 for invalid IDs in ContentVersion VersionData URL
      expect(errorCsvContent).to.match(new RegExp(`${fakeFile.Id}.*Status 404`, 's'));
    }
  });
});
