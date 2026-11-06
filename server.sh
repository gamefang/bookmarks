#!/usr/bin/env bash

ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1
python -m http.server 8262
