ARG BIOC_VERSION=RELEASE_3_22
FROM node:22-bookworm-slim AS node-runtime

FROM bioconductor/bioconductor_docker:${BIOC_VERSION}
USER root
COPY --from=node-runtime /usr/local/ /usr/local/
WORKDIR /opt/ggtree-air

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY backend ./backend
COPY frontend ./frontend
COPY renderer ./renderer
COPY examples ./examples
COPY docs/schemas ./docs/schemas
COPY README.md ./README.md

RUN Rscript renderer/r/install-dependencies.R --with-msa --with-recipes \
    && npm link \
    && ggtree-air check

ENV GGTREE_AIR_ALLOW_NON_LOOPBACK=1
EXPOSE 7391
ENTRYPOINT ["ggtree-air"]
CMD ["--help"]
