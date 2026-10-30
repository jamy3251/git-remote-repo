#!/bin/bash
# Phase 0.3 재현: 1장의 수치를 낸 스크립트를 순서대로 실행하고 로그를 남긴다.
cd /d/Projects/Documents/MotionAngry
for s in s7_cumulative s4_kemophone s13_window s9_contact_rules s11_identity_probe s8_teacher s8_student s6_params; do
  echo "=== $s $(date +%H:%M:%S)" >> results/repro/timing.txt
  python src/$s.py > results/repro/$s.log 2>&1
  echo "exit=$? $(date +%H:%M:%S)" >> results/repro/timing.txt
done
echo DONE >> results/repro/timing.txt
