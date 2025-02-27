import fs, { Stats, PathLike } from 'node:fs';
import { Readable } from 'node:stream';
import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import { SinonStub } from 'sinon';
import axios from 'axios';
import FormData from 'form-data';
import FileImport from '../../../src/commands/fileops/import.js';

type AxiosResponse = {
  data: string;
  headers: Record<string, string>;
};

describe('file import', () => {
  const $$ = new TestContext();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let formDataAppendStub: SinonStub;
  let createStreamStub: SinonStub;
  let axiosPostStub: SinonStub;
  let statStub: SinonStub;
  const csvContent = 'VersionData,Title,PathOnClient\n./Path1.pdf,Title 1,Path1.pdf\n./Path2.pdf,Title 2,Path2.pdf';

  beforeEach(() => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    formDataAppendStub = $$.SANDBOX.stub(FormData.prototype, 'append');

    // this is needed for flag exists: true check to work with a mock file
    statStub = $$.SANDBOX.stub(fs.promises, 'stat').resolves({
      size: 100,
      isFile: () => true,
    } as Stats);

    createStreamStub = $$.SANDBOX.stub(fs, 'createReadStream').callsFake((path: PathLike) => {
      expect(path, 'file path should not be defined').to.not.be.undefined;

      const stream = new Readable({
        read() {
          this.push(Buffer.from(csvContent));
          this.push(null); // Signal end of stream
        },
      });
      return stream as fs.ReadStream;
    });

    axiosPostStub = $$.SANDBOX.stub(axios, 'post').callsFake((url) => {
      expect(url, 'url should not be undefined').to.be.not.undefined;
      return Promise.resolve({
        data: '[{"success":true,"created":true,"id":"12345"},{"success":true,"created":true,"id":"67890"}]',
        headers: { 'content-length': '100' },
      } as AxiosResponse);
    });
  });

  afterEach(() => {
    $$.restore();
  });

  it('should import files', async () => {
    const flags = {
      file: './mockFile.csv',
      'output-dir': './output',
      'target-org': 'mockOrg',
    };

    await FileImport.run(['--file', flags.file, '--target-org', flags['target-org']]);

    expect(createStreamStub.called, 'create stream stub should be called').to.be.true;
    expect(statStub.called, 'stat should be called').to.be.true;
    expect(axiosPostStub.called, 'expected post to be called').to.be.true;
    expect(formDataAppendStub.callCount, 'form data append should be called').to.be.greaterThan(0);
    expect(sfCommandStubs.log.calledWith('File import completed'), 'file import completed in logs').to.be.true;
  });
});
