FROM postgres:17
RUN apt-get update \
    && apt-get install -y --no-install-recommends haproxy \
    && rm -rf /var/lib/apt/lists/*
COPY check-primary.sh /usr/local/bin/check-primary
COPY proxy-start.sh /usr/local/bin/proxy-start
RUN sed -i 's/\r$//' /usr/local/bin/check-primary /usr/local/bin/proxy-start \
    && chmod 0555 /usr/local/bin/check-primary /usr/local/bin/proxy-start
USER postgres
STOPSIGNAL SIGUSR1
ENTRYPOINT ["/usr/local/bin/proxy-start"]
