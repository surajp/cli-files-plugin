# summary

Summary of a command.

# description

More information about a command. Don't repeat the summary.

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

# examples

- <%= config.bin %> <%= command.id %> --file contentversion-ids.csv
