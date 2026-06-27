#include <sys/time.h>
#include <errno.h>

int __futimes64(int fd, const struct timeval* tv) {
  (void)fd;
  (void)tv;
  errno = 0;
  return 0;
}

int __gettimeofday64(struct timeval* tv, void* tz) {
  (void)tz;
  if (tv) {
    tv->tv_sec = 0;
    tv->tv_usec = 0;
  }
  return 0;
}
