# gpt-oss-20b 本地运行

`gpt-oss-20b` 是 OpenAI 的 open-weight 推理模型。它不是 OpenAI API 或 ChatGPT 托管模型，需要用 Ollama、vLLM、Transformers 等本地推理栈运行。

## 本机建议

当前机器已检测到：

- GPU：NVIDIA GeForce RTX 5060 Laptop，8GB VRAM
- 内存：约 16GB，当前空闲较少
- C 盘剩余：约 8.5GB
- D 盘剩余：约 412GB
- Ollama：已安装

官方建议 `gpt-oss-20b` 更适合 16GB 及以上 VRAM 或统一内存。8GB 显存也可以尝试，但会发生 CPU/内存 offload，速度会慢，运行前建议关闭占内存的软件。

## 推荐启动方式

本项目把 Ollama 模型文件放到 D 盘目录 `models/ollama`，并使用 `11435` 端口，避免占满 C 盘默认 Ollama 模型目录，也避免影响你已有的 `11434` Ollama 服务。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-gpt-oss-20b.ps1
```

或者直接用项目命令：

```powershell
npm run gpt-oss:setup
```

脚本会：

- 创建 `models/ollama`
- 设置本次进程的 `OLLAMA_MODELS`
- 在 `127.0.0.1:11435` 启动 Ollama
- 拉取 `gpt-oss:20b`
- 跑一次中文 CLI smoke test
- 跑一次 OpenAI-compatible API smoke test

日常测试：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\chat-gpt-oss-20b.ps1 -Prompt "请解释滑坡监测系统如何使用本地大模型。"
```

如果你想直接验证 OpenAI-compatible API：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\chat-gpt-oss-openai.ps1 -Prompt "请用三点说明滑坡预警报告应包含什么。"
```

或者：

```powershell
npm run gpt-oss:chat:openai
```

## API 调用

Ollama 会暴露 OpenAI-compatible API：

```text
http://127.0.0.1:11435/v1
```

示例请求：

```powershell
$body = @{
  model = "gpt-oss:20b"
  messages = @(
    @{ role = "system"; content = "你是地质灾害监测助手。" },
    @{ role = "user"; content = "用三点说明滑坡预警报告应包含什么。" }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Uri "http://127.0.0.1:11435/v1/chat/completions" `
  -Method Post `
  -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer ollama" } `
  -Body $body
```

## 常见调整

- 想使用默认 Ollama 端口：把脚本参数改成 `-Port 11434`，但要确保默认 Ollama 服务也使用 D 盘模型目录。
- 想跳过下载只启动服务：加 `-SkipPull`。
- 拉取失败或很慢：重新运行同一条脚本即可续传。
- 运行时内存不足：关闭其他程序，或改用更小模型；`gpt-oss-20b` 对这台机器属于勉强可跑。

## 参考

- OpenAI Help Center: https://help.openai.com/en/articles/11870455
- OpenAI Cookbook Ollama guide: https://github.com/openai/openai-cookbook/blob/main/articles/gpt-oss/run-locally-ollama.md
- Ollama gpt-oss library: https://ollama.com/library/gpt-oss
