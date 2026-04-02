# 下载 Linux 版 PocketBase（仓库内 pocketbase 为 macOS 二进制，不可用于 Linux 镜像）
FROM alpine:3.19
RUN apk add --no-cache ca-certificates unzip wget

ARG PB_VERSION=0.22.34
ARG TARGETARCH
RUN set -eux; \
  case "$TARGETARCH" in \
    amd64) ARCH=amd64 ;; \
    arm64) ARCH=arm64 ;; \
    *) ARCH=amd64 ;; \
  esac; \
  wget -qO /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip"; \
  unzip -q /tmp/pb.zip -d /usr/local/bin; \
  chmod +x /usr/local/bin/pocketbase; \
  rm /tmp/pb.zip

WORKDIR /pb
COPY pocketbase/pb_migrations/ ./pb_migrations/
RUN mkdir -p /pb/pb_data
EXPOSE 8090
ENV TZ=Asia/Shanghai
CMD ["sh", "-c", "exec /usr/local/bin/pocketbase serve --http=0.0.0.0:8090"]
