# 雨课堂题目导出器


> 本项目基于 [`soundstarrain/yuketang-assistant`](https://github.com/soundstarrain/yuketang-assistant)


这是一个可独立加载的 Chrome/Edge Manifest V3 扩展。它识别雨课堂页面中的题目，在新的只读结果标签页中集中展示识别内容，并将可用题目导出为 Word `.docx` 文件。

## 安装

1. 使用 Chrome 112+ 或 Chromium Edge 112+。
2. 打开浏览器的扩展管理页，启用“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择项目目录。

## 支持的页面

- 常规题目页：识别页面中当前可读取的题干、选项、题图和公式。
- 复习结果页：在来源明确展示时，同时保留来源答案或解析。
- 云作业页面：优先读取当前页面及其缓存中可验证的题目数据。

云作业缓存可能只包含部分题目。出现这种情况时，结果页会显示“需要核对”提示，并保留已成功识别的内容；请对照来源页面确认缺失部分。

目前该插件仅在长江雨课堂进行过验证，其余版本雨课堂未进行验证，如有问题欢迎提issue。

## 使用

1. 打开受支持的题目页面。
2. 点击浏览器工具栏中的扩展图标开始识别。
3. 识别成功后，浏览器会打开固定的新结果标签页。
4. 在结果页核对题目、来源答案或解析以及警告提示。
5. 点击“导出 Word”生成并开始下载 `.docx` 文件。

未能安全识别的题目会以占位提示保留题号，但不会写入 Word。题图读取失败不会中断整个文档，结果页会说明受影响的题号。

## 项目来源、修改与许可

- 上游项目：[`soundstarrain/yuketang-assistant`](https://github.com/soundstarrain/yuketang-assistant)（雨课堂考试助手）。
- 上游作者及贡献者继续保有其原有代码的版权；本版本新增或修改部分的版权由相应修改者依法享有。
- 本衍生版本及其第一方修改按 [GNU GPLv3](LICENSE.txt) 发布。任何再分发或修改均须继续遵守 GPLv3。
- 随包提供的 KaTeX、KaTeX 字体和 Source Han Sans 分别适用其 MIT 或 SIL OFL 许可证，详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

数据处理说明见 [`PRIVACY.md`](PRIVACY.md)。完整衍生与修改声明见 [`NOTICE.md`](NOTICE.md)，GPLv3 全文见 [`LICENSE.txt`](LICENSE.txt)。
