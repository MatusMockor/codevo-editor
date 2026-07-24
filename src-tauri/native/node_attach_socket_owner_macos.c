#include <arpa/inet.h>
#include <errno.h>
#include <libproc.h>
#include <netinet/in.h>
#include <stdint.h>
#include <sys/proc_info.h>
#include <sys/socket.h>

#define CODEVO_MAX_PROCESS_FDS 4096

enum codevo_socket_owner_status {
  CODEVO_SOCKET_OWNER_MATCH = 0,
  CODEVO_SOCKET_OWNER_NO_MATCH = 1,
  CODEVO_SOCKET_OWNER_INVALID_INPUT = 2,
  CODEVO_SOCKET_OWNER_UNAVAILABLE = 3,
  CODEVO_SOCKET_OWNER_CAPACITY_EXCEEDED = 4,
  CODEVO_SOCKET_OWNER_ABI_MISMATCH = 5,
  CODEVO_SOCKET_OWNER_AMBIGUOUS = 6,
};

static int codevo_is_exact_loopback(const struct in_sockinfo *info,
                                    int address_family) {
  if (address_family == AF_INET) {
    return (info->insi_vflag & INI_IPV4) != 0 &&
           info->insi_laddr.ina_46.i46a_addr4.s_addr ==
               htonl(INADDR_LOOPBACK);
  }
  if (address_family == AF_INET6) {
    return (info->insi_vflag & INI_IPV6) != 0 &&
           IN6_IS_ADDR_LOOPBACK(&info->insi_laddr.ina_6);
  }
  return 0;
}

int codevo_process_owns_loopback_tcp_listener(int process_id,
                                              uint16_t host_port,
                                              int address_family) {
  if (process_id <= 0 || host_port == 0 ||
      (address_family != AF_INET && address_family != AF_INET6)) {
    return CODEVO_SOCKET_OWNER_INVALID_INPUT;
  }

  struct proc_fdinfo descriptors[CODEVO_MAX_PROCESS_FDS + 1];
  errno = 0;
  int descriptor_bytes =
      proc_pidinfo(process_id, PROC_PIDLISTFDS, 0, descriptors,
                   (int)sizeof(descriptors));
  if (descriptor_bytes < 0 ||
      (descriptor_bytes == 0 && errno != 0)) {
    return CODEVO_SOCKET_OWNER_UNAVAILABLE;
  }
  if (descriptor_bytes % (int)sizeof(struct proc_fdinfo) != 0) {
    return CODEVO_SOCKET_OWNER_ABI_MISMATCH;
  }
  size_t descriptor_count =
      (size_t)descriptor_bytes / sizeof(struct proc_fdinfo);
  if (descriptor_count > CODEVO_MAX_PROCESS_FDS) {
    return CODEVO_SOCKET_OWNER_CAPACITY_EXCEEDED;
  }

  for (size_t index = 0; index < descriptor_count; ++index) {
    if (descriptors[index].proc_fdtype != PROX_FDTYPE_SOCKET) {
      continue;
    }
    struct socket_fdinfo socket;
    errno = 0;
    int socket_bytes =
        proc_pidfdinfo(process_id, descriptors[index].proc_fd,
                       PROC_PIDFDSOCKETINFO, &socket, (int)sizeof(socket));
    if (socket_bytes == 0 &&
        (errno == EBADF || errno == ENOENT || errno == ENOTSOCK)) {
      continue;
    }
    if (socket_bytes <= 0) {
      return CODEVO_SOCKET_OWNER_UNAVAILABLE;
    }
    if (socket_bytes != (int)sizeof(socket)) {
      return CODEVO_SOCKET_OWNER_ABI_MISMATCH;
    }

    const struct socket_info *info = &socket.psi;
    const struct tcp_sockinfo *tcp = &info->soi_proto.pri_tcp;
    if (info->soi_kind != SOCKINFO_TCP || info->soi_type != SOCK_STREAM ||
        info->soi_protocol != IPPROTO_TCP ||
        info->soi_family != address_family ||
        tcp->tcpsi_state != TSI_S_LISTEN ||
        ntohs((uint16_t)tcp->tcpsi_ini.insi_lport) != host_port ||
        !codevo_is_exact_loopback(&tcp->tcpsi_ini, address_family)) {
      continue;
    }
    return CODEVO_SOCKET_OWNER_MATCH;
  }
  return CODEVO_SOCKET_OWNER_NO_MATCH;
}

int codevo_process_owns_held_loopback_tcp_connection(
    int process_id, uint16_t server_host_port, uint16_t client_host_port,
    int address_family, uint64_t *listener_generation,
    uint64_t *connection_generation, uint64_t *connection_socket,
    uint64_t *connection_pcb, uint64_t *connection_tcp_control_block) {
  if (process_id <= 0 || server_host_port == 0 || client_host_port == 0 ||
      listener_generation == NULL || connection_generation == NULL ||
      connection_socket == NULL || connection_pcb == NULL ||
      connection_tcp_control_block == NULL ||
      (address_family != AF_INET && address_family != AF_INET6)) {
    return CODEVO_SOCKET_OWNER_INVALID_INPUT;
  }

  struct proc_fdinfo descriptors[CODEVO_MAX_PROCESS_FDS + 1];
  errno = 0;
  int descriptor_bytes =
      proc_pidinfo(process_id, PROC_PIDLISTFDS, 0, descriptors,
                   (int)sizeof(descriptors));
  if (descriptor_bytes < 0 || (descriptor_bytes == 0 && errno != 0)) {
    return CODEVO_SOCKET_OWNER_UNAVAILABLE;
  }
  if (descriptor_bytes % (int)sizeof(struct proc_fdinfo) != 0) {
    return CODEVO_SOCKET_OWNER_ABI_MISMATCH;
  }
  size_t descriptor_count =
      (size_t)descriptor_bytes / sizeof(struct proc_fdinfo);
  if (descriptor_count > CODEVO_MAX_PROCESS_FDS) {
    return CODEVO_SOCKET_OWNER_CAPACITY_EXCEEDED;
  }

  int found_listener = 0;
  int found_connection = 0;
  uint64_t found_listener_generation = 0;
  uint64_t found_connection_generation = 0;
  uint64_t found_connection_socket = 0;
  uint64_t found_connection_pcb = 0;
  uint64_t found_connection_tcp_control_block = 0;
  for (size_t index = 0; index < descriptor_count; ++index) {
    if (descriptors[index].proc_fdtype != PROX_FDTYPE_SOCKET) {
      continue;
    }
    struct socket_fdinfo socket;
    errno = 0;
    int socket_bytes =
        proc_pidfdinfo(process_id, descriptors[index].proc_fd,
                       PROC_PIDFDSOCKETINFO, &socket, (int)sizeof(socket));
    if (socket_bytes == 0 &&
        (errno == EBADF || errno == ENOENT || errno == ENOTSOCK)) {
      continue;
    }
    if (socket_bytes <= 0) {
      return CODEVO_SOCKET_OWNER_UNAVAILABLE;
    }
    if (socket_bytes != (int)sizeof(socket)) {
      return CODEVO_SOCKET_OWNER_ABI_MISMATCH;
    }

    const struct socket_info *info = &socket.psi;
    const struct tcp_sockinfo *tcp = &info->soi_proto.pri_tcp;
    if (info->soi_kind != SOCKINFO_TCP || info->soi_type != SOCK_STREAM ||
        info->soi_protocol != IPPROTO_TCP ||
        info->soi_family != address_family ||
        ntohs((uint16_t)tcp->tcpsi_ini.insi_lport) != server_host_port ||
        !codevo_is_exact_loopback(&tcp->tcpsi_ini, address_family)) {
      continue;
    }
    if (tcp->tcpsi_state == TSI_S_LISTEN) {
      if (found_listener &&
          found_listener_generation != tcp->tcpsi_ini.insi_gencnt) {
        return CODEVO_SOCKET_OWNER_AMBIGUOUS;
      }
      found_listener = 1;
      found_listener_generation = tcp->tcpsi_ini.insi_gencnt;
      continue;
    }
    if (tcp->tcpsi_state == TSI_S_ESTABLISHED &&
        ntohs((uint16_t)tcp->tcpsi_ini.insi_fport) == client_host_port &&
        ((address_family == AF_INET &&
          tcp->tcpsi_ini.insi_faddr.ina_46.i46a_addr4.s_addr ==
              htonl(INADDR_LOOPBACK)) ||
         (address_family == AF_INET6 &&
          IN6_IS_ADDR_LOOPBACK(&tcp->tcpsi_ini.insi_faddr.ina_6)))) {
      if (found_connection &&
          (found_connection_generation != tcp->tcpsi_ini.insi_gencnt ||
           found_connection_socket != info->soi_so ||
           found_connection_pcb != info->soi_pcb ||
           found_connection_tcp_control_block != tcp->tcpsi_tp)) {
        return CODEVO_SOCKET_OWNER_AMBIGUOUS;
      }
      found_connection = 1;
      found_connection_generation = tcp->tcpsi_ini.insi_gencnt;
      found_connection_socket = info->soi_so;
      found_connection_pcb = info->soi_pcb;
      found_connection_tcp_control_block = tcp->tcpsi_tp;
    }
  }
  if (!found_listener || !found_connection) {
    return CODEVO_SOCKET_OWNER_NO_MATCH;
  }
  *listener_generation = found_listener_generation;
  *connection_generation = found_connection_generation;
  *connection_socket = found_connection_socket;
  *connection_pcb = found_connection_pcb;
  *connection_tcp_control_block = found_connection_tcp_control_block;
  return CODEVO_SOCKET_OWNER_MATCH;
}
