/* FMOD FADPCM -> s16le PCM. stdin: raw FSB sample data; argv[1] channels. Frames of 0x8c bytes
   interleaved per channel: u32 coefs, u32 shifts, s16 hist1, s16 hist2, then 8 groups x 4 u32 of
   nibbles (algorithm as documented by vgmstream's fadpcm_decoder.c). */
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
static const int coefs_t[8][2] = {{0,0},{60,0},{122,60},{115,52},{98,55},{0,0},{0,0},{0,0}};
static int16_t clamp16(int32_t v){ return v > 32767 ? 32767 : v < -32768 ? -32768 : v; }
static uint32_t u32(const uint8_t*p){ return p[0]|p[1]<<8|p[2]<<16|(uint32_t)p[3]<<24; }
int main(int argc, char**argv){
  int ch = argc > 1 ? atoi(argv[1]) : 1; if (ch < 1 || ch > 8) ch = 1;
  size_t cap = 1<<20, n = 0; uint8_t *buf = malloc(cap); size_t r;
  while ((r = fread(buf+n, 1, cap-n, stdin)) > 0) { n += r; if (n == cap) { cap *= 2; buf = realloc(buf, cap); } }
  size_t frames = n / (0x8c * ch); int16_t out[8][256];
  for (size_t f = 0; f < frames; f++) {
    for (int c = 0; c < ch; c++) {
      const uint8_t *fr = buf + (f*ch + c) * 0x8c;
      uint32_t coefs = u32(fr), shifts = u32(fr+4);
      int32_t h1 = (int16_t)(fr[8]|fr[9]<<8), h2 = (int16_t)(fr[10]|fr[11]<<8); int k2 = 0;
      for (int i = 0; i < 8; i++) {
        int idx = ((coefs >> (i*4)) & 0xf) % 7, sh = 22 - (int)((shifts >> (i*4)) & 0xf);
        int c1 = coefs_t[idx][0], c2 = coefs_t[idx][1];
        for (int j = 0; j < 4; j++) {
          uint32_t nib = u32(fr + 0x0c + 0x10*i + 4*j);
          for (int k = 0; k < 8; k++) {
            int32_t s = (int32_t)(((nib >> (k*4)) & 0xf) << 28) >> sh;
            s = (s - h2*c2 + h1*c1) >> 6; int16_t v = clamp16(s);
            out[c][k2++] = v; h2 = h1; h1 = v;
          }
        }
      }
    }
    for (int k = 0; k < 256; k++) for (int c = 0; c < ch; c++) fwrite(&out[c][k], 2, 1, stdout);
  }
  return 0;
}
