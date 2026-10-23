---
title: prettier를 기본 폭으로 돌리면 파일 전체가 바뀜
tags: [prettier, 서식, diff]
---

## 증상
서식 정리를 위해 prettier를 돌렸더니 한 줄 고친 파일이 통째로 diff에 잡힌다.

## 원인
이 저장소에는 prettier 설정이 없고 기존 코드는 한 줄 200자 기준으로 쓰여 있다.

## 해결
`--print-width 200` 으로만 돌린다. 변경한 줄 밖은 건드리지 않는 것이 더 안전하다.
