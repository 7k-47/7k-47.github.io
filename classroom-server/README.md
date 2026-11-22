# 教师机共享导师

学生打开教师发放的课堂链接即可使用同一台教师机上的模型。提问、报告分析和模型推理都在教师机处理。实验计算由网页中的物理求解器完成。

## 教师机启动

在仓库目录安装 Node.js 22 或更新版本，然后运行：

```sh
npm ci --prefix classroom-server
npm start --prefix classroom-server -- --lan
```

首次需要下载约 2.5 GB 的 Qwen3 4B 普通话可用模型，后续使用教师机的本地缓存。等终端显示「课堂模型已就绪」，把终端列出的学生访问地址发给同一学校网络中的学生。教师可以先打开自己的页面，并在「模型」里查看「课堂共享导师」是否连接。

如果学校已有相同的 GGUF 模型文件，启动时可用 `--model /路径/模型.gguf`。端口可用 `--port 8081` 调整。去掉 `--lan` 时，仅教师机本机可访问。

## 网络与保存

- 教师机与学生机需要网络连通。部分学校的无线网络会隔离设备，这时可由学校分配可访问的教师机地址。
- 同一局域网内可以用终端提供的 HTTP 地址。浏览器通常只在 HTTPS 或本机回环地址下允许网页访问麦克风。学校如需校外访问，可以在受控 HTTPS 入口后运行本服务。
- 记录和草稿按站点地址保存在学生的浏览器中。切换 GitHub Pages 与教师机地址前，可以先导出已有报告。
- 公网 GitHub Pages 继续提供规则导师、完整实验、照片本机识读和自然语音。教师机服务从上面的课堂地址进入。

课堂模型由 [Qwen](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) 提供，通过 [node-llama-cpp](https://node-llama-cpp.withcat.ai/) 运行。使用 [GGUF 量化版本](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF)。
