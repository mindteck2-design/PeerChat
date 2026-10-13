#!/bin/bash
echo "PROBE $(date)" > /mnt/d/PeerChat/wsl-probe.txt
command -v rustc >> /mnt/d/PeerChat/wsl-probe.txt 2>&1 || echo NO_RUST >> /mnt/d/PeerChat/wsl-probe.txt
command -v cargo >> /mnt/d/PeerChat/wsl-probe.txt 2>&1 || echo NO_CARGO >> /mnt/d/PeerChat/wsl-probe.txt
command -v node >> /mnt/d/PeerChat/wsl-probe.txt 2>&1 || echo NO_NODE >> /mnt/d/PeerChat/wsl-probe.txt
ls /mnt/d/PeerChat/app/package.json >> /mnt/d/PeerChat/wsl-probe.txt 2>&1
echo DONE >> /mnt/d/PeerChat/wsl-probe.txt
