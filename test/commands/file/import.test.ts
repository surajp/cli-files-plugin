import fs from 'node:fs';
import { Readable } from 'node:stream';
import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import { SinonStub } from 'sinon';
import axios from 'axios';
import FormData from 'form-data';
import FileImport from '../../../src/commands/file/import.js';

type AxiosResponse = {
  data: string;
  headers: Record<string, string>;
};

describe('file import', () => {
  const $$ = new TestContext();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let formDataAppendStub: SinonStub;
  const csvContent = 'VersionData,Title,PathOnClient\n./Path1.pdf,Title 1,Path1.pdf\n./Path2.pdf,Title 2,Path2.pdf';

  beforeEach(() => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
  });

  afterEach(() => {
    $$.restore();
  });

  it('should import files', async () => {
    formDataAppendStub = $$.SANDBOX.stub(FormData.prototype, 'append');

    $$.SANDBOX.stub(fs, 'createReadStream').callsFake((path: fs.PathLike) => {
      expect(path).to.be.not.undefined;
      const stream = new Readable({
        read() {
          this.push(Buffer.from(csvContent));
          this.push(null); // Signal end of stream
        },
      });
      return stream as fs.ReadStream;
    });

    const axiosPostStub: SinonStub = $$.SANDBOX.stub(axios, 'post').callsFake((url) => {
      expect(url).to.be.not.undefined;
      return Promise.resolve({
        data: '[{"success":true,"created":true,"id":"12345"},{"success":true,"created":true,"id":"67890"}]',
        headers: { 'content-length': '100' },
      } as AxiosResponse);
    });

    $$.SANDBOX.stub(fs, 'statSync').callsFake((path: fs.PathLike) => {
      expect(path).to.be.not.undefined;
      return { size: 100 } as fs.Stats;
    });

    const flags = {
      file: './mock.csv',
      'output-dir': './output',
      'target-org': 'mockOrg',
    };

    await FileImport.run(['--file', flags.file, '--target-org', flags['target-org']]);

    expect(axiosPostStub.called, 'expected post to be called').to.be.true;
    expect(formDataAppendStub.callCount).to.be.greaterThan(0);
    expect(sfCommandStubs.log.calledWith('File import completed.')).to.be.true;
  });
});
