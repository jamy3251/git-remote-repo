---
title: python heredoc으로 TS 코드를 고치면 이스케이프가 깨짐
tags: [python, heredoc, 이스케이프, typescript]
---

## 증상
heredoc 안의 python으로 TS 소스를 치환했더니 `"\n"`, `"\\"` 가 실제 줄바꿈이나 역슬래시 하나로 바뀌어 `Unterminated string literal` 이 난다.

## 원인
python 일반 문자열에서 백슬래시가 한 번 더 해석된다. 여러 번 반복된 실수.

## 해결
Edit 도구를 쓴다. 꼭 python이 필요하면 치환할 TS 조각을 raw 문자열(r'''...''')로 쓰거나 스크래치 .py 파일에 저장해 실행한다. 고친 뒤 `npx tsc --noEmit` 으로 바로 확인한다.

## 관련
- 2026-10-23 playbook.ts 작업 중 chat.ts에서 재발
