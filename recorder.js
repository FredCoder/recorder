// 工具包
const utils = {
    createAudioNode(audioContext) {

        /* 
         * AudioNode，缓冲区音频处理模块
         * 处理输入和输出的音频数据
         * 详细=>http://t.cn/RajQ7IR
         */

        const option = {
            bufferSize: 4096,       // 每个块的大小是4k
            inputChannelCount: 2,   // 输入为双声道
            outputChannelCount: 2   // 输出为双声道
        };

        return audioContext.createScriptProcessor(option.bufferSize, option.inputChannelCount, option.outputChannelCount);
    },

    mergeArray(list) {

        let length = list.length * list[0].length;

        let merge = new Float32Array(length),
            offset = 0;

        for (let i = 0; i < list.length; i++) {
            merge.set(list[i], offset);
            offset += list[i].length;
        };

        return merge;
    },

    // 交叉合并左右声道数据
    mergeChannel(left, right) {

        let length = left.length + right.length;

        let merge = new Float32Array(length);

        for (let i = 0; i < left.length; i++) {
            let k = i * 2;
            merge[k] = left[i];
            merge[k + 1] = right[i];
        };

        return merge;
    },

    writeUTFBytes(view, offset, string) {

        let length = string.length;

        for (let i = 0; i < length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        };
    }
};

// wav音频文件构造函数
class Wav {
    constructor(data) {

        const WAV_HEAD_SIZE = 44;

        let buffer = new ArrayBuffer(data.length * 2 + WAV_HEAD_SIZE);

        // 用DataView来操控buffer
        this.view = new DataView(buffer);

        // 写入wav头部信息
        this.writeHead(data.length * 2);

        // 写入PCM数据
        this.writeFile(data);

        return buffer;
    }
    writeHead(length) {
        // 写入wav头部信息

        // RIFF chunk descriptor/identifier
        utils.writeUTFBytes(this.view, 0, 'RIFF');

        // RIFF chunk length
        this.view.setUint32(4, 44 + length, true);

        // RIFF type
        utils.writeUTFBytes(this.view, 8, 'WAVE');

        // format chunk identifier
        // FMT sub-chunk
        utils.writeUTFBytes(this.view, 12, 'fmt ');

        // format chunk length
        this.view.setUint32(16, 16, true);

        // sample format (raw)
        this.view.setUint16(20, 1, true);

        // stereo (2 channels)
        this.view.setUint16(22, 2, true);

        // sample rate
        this.view.setUint32(24, 44100, true);

        // byte rate (sample rate * block align)
        this.view.setUint32(28, 44100 * 2, true);

        // block align (channel count * bytes per sample)
        this.view.setUint16(32, 2 * 2, true);

        // bits per sample
        this.view.setUint16(34, 16, true);

        // data sub-chunk
        // data chunk identifier
        utils.writeUTFBytes(this.view, 36, 'data');

        // data chunk length
        this.view.setUint32(40, length, true);
    }
    writeFile(data) {
        // 写入PCM数据
        let length = data.length,
            index = 44,
            volume = 1;

        for (let i = 0; i < length; i++) {
            this.view.setInt16(index, data[i] * (0x7FFF * volume), true);
            index += 2;
        };
    }
};

// 录音器构造函数
class Recorder {
    constructor() {

        // 录音机状态
        this.status = 'pause';

        // 缓存仓库
        this.store = {
            // 左声道
            channel_left: [],
            // 右声道
            channel_right: []
        };

        // 杂项数据
        this.pipe = {};
    }

    clearStore() {
        // 清空数据
        this.store.channel_left.splice(0);
        this.store.channel_right.splice(0);
    }

    record(buffer) {
        // 记录缓存录音数据
        let channel_left = buffer.getChannelData(0),
            channel_right = buffer.getChannelData(1);

        // 双声道
        this.store.channel_left.push(channel_left.slice(0));
        this.store.channel_right.push(channel_right.slice(0));
    }

    start(record_config = {}) {

        // 录制中，不响应操作
        if (this.status === 'recording') return new Error('In recording!');

        // 非录制中，开始录音操作

        // 清除上次缓存
        this.clearStore();

        // 更改状态为录制中
        this.status = 'recording';

        // 录音API getUserMedia 参数配置
        let option = Object.assign({
            sampleRate: 44100, // 采样率
            channelCount: 2, // 声道
            volume: 1.0 // 音量
        }, record_config);

        // 调用媒体API，向用户请求麦克风使用权
        let recorder = navigator.mediaDevices.getUserMedia({
            // 合并参数
            audio: option
        });

        // 获得权限后开始操作
        recorder.then((mediaStream) => {
            this.handler(mediaStream)
        });

        // 用户拒绝授权，重置状态并抛出异常信息
        recorder.catch(() => {
            this.status = 'pause';
            throw new Error('Users refuse authorization to use microphones.');
        });
    }

    stop() {
        // 非录制中，不响应操作
        if (this.status !== 'recording') return Promise.reject(new Error('Run start before stop'));
        this.status = 'pause';

        // 停止录音
        this.pipe.mediaStream.getAudioTracks()[0].stop();
        this.pipe.mediaSource.disconnect();
        this.pipe.audioNode.disconnect();

        // 整合缓存区的数据
        let left = utils.mergeArray(this.store.channel_left),
            right = utils.mergeArray(this.store.channel_right);

        // 声道数据合并
        let datas = utils.mergeChannel(left, right);

        // 转换并返回wav录音数据(blob)
        return new Wav(datas);

    }

    handler(mediaStream) {
        /*
         * 操作逻辑
         * 原理很简单，利用浏览器提供的音频API AudioContext
         * 向用户请求麦克风使用授权，
         * 然后创建mediaSource，接收来自麦克风的音频数据流，
         * 利用音频API AudioNode, 在录音数据流推送时，
         * 并将数据缓存起来，等待结束录音。
         * 
         * 此时，mediaSource是没有得到AudioContext.destination的，
         * 所以扬声器不会有声音发出。
         * 
         * 当用户操作结束流程时，停止麦克风录入，
         * 停止mediaSource的接收，停止AudioNode的录入
         * 再对缓存的数据进行合并处理，
         * 最终通过wav格式数据的转换，返回blob数据
         */

        // 录音数据流
        this.pipe.mediaStream = mediaStream;

        // 音频API，作用等同audio标签，详细=>http://t.cn/RvQZCuy
        this.pipe.audioContext = new(window.AudioContext || window.webkitAudioContext)();

        // 转换媒体源，接收媒体流对象后，可播放或操作音频
        this.pipe.mediaSource = this.pipe.audioContext.createMediaStreamSource(mediaStream);

        // 音频API，输入音频，可加工音源后输出
        this.pipe.audioNode = utils.createAudioNode(this.pipe.audioContext);

        /*
         * audioContext.destination是音频要最终输出的目标，可以把它理解为声卡
         * 所有节点中的最后一个节点应该再连接到audioContext.destination才能听到声音。
         */
        this.pipe.audioNode.connect(this.pipe.audioContext.destination);

        // 当音频推送过来时，缓存录音数据
        this.pipe.audioNode.addEventListener('audioprocess', event => {
            this.record(event.inputBuffer)
        }, false);

        // 最后把mediaNode连接到audioNode, 完成流程。
        // audioNode不会有数据返回，mediaSource不会在录音期间播放声音
        this.pipe.mediaSource.connect(this.pipe.audioNode);
    }
}
