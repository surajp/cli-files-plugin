# summary

Exports binary data for ContentVersion records (Files) from Salesforce using the Composite Batch API.

# description

The command efficiently exports multiple files from Salesforce by processing ContentVersion records in batches using the Composite Batch API. Provide a CSV file containing the ContentVersion Ids to be exported.

# flags.file.summary

The file containing ContentVersion IDs.

# flags.file.description

The CSV file should have a column (default 'Id', configurable with --id) with the ContentVersion IDs to be exported. The file may contain additional columns, but they will be ignored unless specified (e.g., for file extensions via --ext-col-name).

# flags.output-dir.summary

The directory to save the exported ContentVersion files.

# flags.output-dir.description

The path may be absolute or relative to the current working directory. The directory will be created if it does not exist. The exported files will be saved in the directory with the Id as the filename (plus extension, if provided). If using an existing directory, any files with the same name will be overwritten.

# flags.id.summary

Name of the column in the CSV file that contains the ContentVersion IDs.

# flags.id.description

Avoid spaces and special characters in the column name. The default value is `Id`.

# examples

- <%= config.bin %> <%= command.id %> --file contentversion-ids.csv --output-dir ./exported_files --target-org myorgalias
- <%= config.bin %> <%= command.id %> --file cv_data.csv --output-dir ./downloads --id DocumentId --ext-col-name Extension --target-org myorgalias

# flags.ext-col-name.summary

Name of the column in the CSV file containing the file extension.

# flags.ext-col-name.description

The column may contain just the extension (e.g., pdf, jpeg) or a full filename including the extension (e.g., AnnualReport.pdf, in which case the extension is extracted). If specified, the downloaded file will be named <fileid>.<extension>. If not specified, the downloaded file will be named simply <fileid>.
