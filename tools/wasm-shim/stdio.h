#ifndef SPIKE_STDIO_H
#define SPIKE_STDIO_H
typedef struct { char _x; } FILE;
extern FILE *stderr;
int fprintf(FILE *s, const char *f, ...);
#endif
