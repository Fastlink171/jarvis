## M.I.K.U 1.21.0: wake-phrase fixes

- **Wakes more reliably:** the detector now also listens for spellings of how the name actually sounds (for Miku: "Mee-koo", "Mikoo"), so normal speech matches better.
- **Gentler sensitivity:** 100% sensitivity is no longer extreme, so random wake-ups should stop.
- **Windows-safe model loading:** the detector now opens its files the way the speech runtime expects on Windows.
- **Wake log:** the detector records what it's doing in `wake-log.txt` in the app's data folder (when it starts, when it hears the phrase, and any errors), which makes problems easy to track down.
