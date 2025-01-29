# summary

Export binary data for ContentVersion records (Files) from Salesforce

# description

The command uses concurrent processes to speed up the export process. The input csv file should contain the ContentVersion Ids to be exported.

# flags.file.summary

The file containing contentversion ids.

# flags.file.description

The csv file should have a column `Id` with the contentversion ids to be exported. The file may contain additional columns, but they will be ignored.

# flags.output-dir.summary

The directory to save the exported contentversion files. The path may be absolute or relative to the current working directory.

# flags.output-dir.description

The directory will be created if it does not exist. The exported files will be saved in the directory with the Id as the filename. If using an existing directory, any files with the same name will be overwritten.

# flags.concurrency.summary

The number of concurrent requests to make to the Salesforce API.

# flags.concurrency.description

More concurrent requests will be faster but may cause the Salesforce API to return errors and throttle system resources.

# flags.id.summary

Name of the column in the CSV file that contains the ContentVersion Ids.

# flags.id.description

Avoid spaces and special characters in the column name. The default value is `Id`.

# examples

- <%= config.bin %> <%= command.id %> --file contentversion-ids.csv

# flags.ext-col-name.summary

File extension column name.

# flags.ext-col-name.description

Name of the column in the csv file containing the file extension. The column may contain just the extension (eg: pdf, jpeg, etc.) or filename including extension (eg: AnnualReport.pdf). If specified, the downloaded file will be named <fileid>.<extension>. If not, it will just be named <file id>
