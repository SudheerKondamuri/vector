# Build and publish this image, then deploy only its immutable registry digest
# through VERIFIER_IMAGE. The runtime entrypoint is fixed; submissions cannot
# replace the command or network policy.
FROM ghcr.io/foundry-rs/foundry:stable

COPY entrypoint.mjs /usr/local/bin/vector-verifier.mjs
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends nodejs ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && chmod 0555 /usr/local/bin/vector-verifier.mjs \
  && useradd --system --uid 10001 --no-create-home vector-verifier
USER 10001:10001
ENTRYPOINT ["node", "/usr/local/bin/vector-verifier.mjs"]
