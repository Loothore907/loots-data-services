# PowerShell script to backup vendors with date in filename
$date = Get-Date -Format "yyyyMMdd"
$outputPath = "./data/backup/vendors_backup_$date.json"

# Create backup directory if it doesn't exist
$backupDir = "./data/backup"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force
}

# Run the export-vendors script with the date-based filename
npm run export-vendors -- --output=$outputPath --pretty

Write-Host "Backup completed: $outputPath" 