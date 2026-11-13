---
title: Git Bash에서 curl로 한글을 보내면 깨짐
tags: [curl, git-bash, 인코딩, windows]
---

## 증상
Git Bash에서 `curl -d '{"text":"한글"}'` 로 보낸 한글이 서버에서 깨져 보인다.

## 원인
Windows 콘솔 코드페이지를 거치며 인자 문자열이 UTF-8이 아닌 상태로 넘어간다.

## 해결
UTF-8 JSON 파일을 만들어 `--data-binary @파일` 로 보낸다. 헤더에 `Content-Type: application/json; charset=utf-8` 도 넣는다.

## 예시
curl -H "Content-Type: application/json; charset=utf-8" --data-binary @body.json http://127.0.0.1:7331/...
