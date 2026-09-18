# Dashboard chart split measurement

Measured with `npm run build` and the Vite production output. The pre-Issue #3
build bundled charts into the route chunk; the post-Issue #3 build loads charts
as a separate async chunk.

| Build | Dashboard route chunk | Academic chart chunk |
| --- | ---: | ---: |
| Before lazy loading | 269,173 bytes | included in route |
| After lazy loading | 21,060 bytes (6.97 kB gzip) | 248,690 bytes (78.15 kB gzip) |

The initial Dashboard route chunk is therefore 248,113 bytes smaller (92.2%).
The chart chunk is requested independently after the Dashboard mounts, so the
header, stats, schedule, deadlines, and error sections can render first.
