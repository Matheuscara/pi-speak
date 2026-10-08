# pi-speak

Local text-to-speech for Pi and Oh My Pi (OMP).

## Install

```bash
pi install ssh://git@github.com/s1m0n38/pi-speak
```

### Oh My Pi

Tested with OMP 18.8.4. OMP 18.2.11 cannot resolve a transitive `sharp` dependency from this extension; upgrade OMP if `speak` fails with `Cannot find package 'detect-libc'` or `Could not load the "sharp" module`.

Clone and link the extension so OMP loads it in future sessions:

```bash
git clone https://github.com/S1M0N38/pi-speak.git
cd pi-speak
npm ci --ignore-scripts
omp plugin link "$PWD"
omp
```

Alternatively, use `omp -e /absolute/path/to/pi-speak` for one session. Run `/speak` in the interactive TUI to choose a voice and download the local Kokoro model before using the shortcut or `speak` tool. Restart an already-running OMP session after linking the plugin.

On Linux, install an audio player such as `pw-play` (PipeWire), `paplay` (PulseAudio), or `aplay` (ALSA), and ensure it is executable on `PATH`. This also supports NixOS profile paths such as `/run/current-system/sw/bin` and `~/.nix-profile/bin`. On macOS, `afplay` is used.

On NixOS, if Bun fails to load `sharp` with `ERR_DLOPEN_FAILED: libstdc++.so.6`, launch OMP with the GCC runtime library on `LD_LIBRARY_PATH`. In a Nix wrapper, obtain the directory from `${pkgs.stdenv.cc.cc.lib}/lib` rather than hardcoding a `/nix/store` path. Keep this environment change scoped to the OMP process.

## Usage

The extension registers:

- `speak` tool that the agent can use to synthesize speech locally via Kokoro;
- `/speak` for voice, speed, and model settings;
- `Ctrl+Alt+X` to speak the last agent message.

To develop or run it from a checkout:

```bash
npm install --ignore-scripts
pi -e /absolute/path/to/pi-speak
```

While iterating on setup, enable the debug-only onboarding command when starting Pi:

```bash
PI_SPEAK_DEBUG=1 pi -e /absolute/path/to/pi-speak
```

Then run `/speak-onboarding` to replay the complete onboarding flow. The command is not registered unless `PI_SPEAK_DEBUG=1`.

## Development

```bash
npm run check   # tsc --noEmit
npm test        # check + node scripts/run-tests.mjs
```
