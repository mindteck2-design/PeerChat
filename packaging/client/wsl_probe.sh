#!/bin/bash
echo "PROBE $(date)" > /mnt/d/LanMsg/wsl-probe.txt
command -v rustc >> /mnt/d/LanMsg/wsl-probe.txt 2>&1 || echo NO_RUST >> /mnt/d/LanMsg/wsl-probe.txt
command -v cargo >> /mnt/d/LanMsg/wsl-probe.txt 2>&1 || echo NO_CARGO >> /mnt/d/LanMsg/wsl-probe.txt
command -v node >> /mnt/d/LanMsg/wsl-probe.txt 2>&1 || echo NO_NODE >> /mnt/d/LanMsg/wsl-probe.txt
ls /mnt/d/LanMsg/app/package.json >> /mnt/d/LanMsg/wsl-probe.txt 2>&1
echo DONE >> /mnt/d/LanMsg/wsl-probe.txt
