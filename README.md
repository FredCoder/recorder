# recorder

HTML5 录音机实现
把麦克风的音频转化为pcm/wav，并需要可自行操作

## 示例
Recorder config是可选参数，传入后会合并到 navigator.mediaDevices.getUserMedia(constraints) constraints-> audio

[详细参数配置](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#Parameters)

```
let recorder = new Recorder(config[option])

// 开始录音
recorder.start()

// 结束录音，stop会返回录音文件（wav）的blob数据，此后自行操作该数据
let blob = recorder.stop()
console.log(blob)
```
