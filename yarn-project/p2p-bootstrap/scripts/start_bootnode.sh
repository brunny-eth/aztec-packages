#! /bin/bash
set -eu

cd ..
export P2P_TCP_LISTEN_PORT=40400
export PEER_ID='0a260024080112205ea53185db2e52dae74d0d4d6cadc494174810d0a713cd09b0ac517c38bc781e1224080112205ea53185db2e52dae74d0d4d6cadc494174810d0a713cd09b0ac517c38bc781e1a44080112402df8b977f356c6e34fa021c9647973234dff4df706c185794405aafb556723cf5ea53185db2e52dae74d0d4d6cadc494174810d0a713cd09b0ac517c38bc781e'
yarn build
yarn start