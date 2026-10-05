# Process monitoring lesson

[REPORTED, root observation, 2026-09-05] A macOS `pgrep -fl` check included an inherited credential in an npm process argument. Root stopped process inspection and instructed credential rotation. The credential value and raw listing are intentionally not recorded.

[INFERRED, scoped rule] Monitor only owned output and evidence files. Never persist full environment or process listings. Treat command arguments as potentially sensitive even when a process list is requested for diagnosis.
