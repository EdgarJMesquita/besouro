# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-22

First public release. Requires React Native 0.77+ on the New Architecture, or
Expo SDK 53+ in a dev build — Expo Go cannot load native code.

### Added

Twelve inspectors behind a draggable in-app bubble. No laptop, no remote debugger.

On by default, because they patch globals that are already there:

- **Network** — every request and response, with copy as cURL
- **Console** — logs, uncaught errors, and native crashes recovered on the next launch
- **WebSocket** — frames in both directions
- **Element** — tap any component to read and edit its props
- **Files** — browse and share the app's sandbox

Off until you hand Besouro the dependency they watch, so none of them is bundled:

- **Redux**, **Zustand**, **Jotai** — dispatched actions, live state, and what changed
- **AsyncStorage**, **MMKV** — every operation, plus the stored contents for MMKV
- **Socket.IO** — events in both directions
- **Notifications** — Expo, Firebase and Notifee, plus the device push token

[unreleased]: https://github.com/EdgarJMesquita/besouro/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/EdgarJMesquita/besouro/releases/tag/v0.1.0
