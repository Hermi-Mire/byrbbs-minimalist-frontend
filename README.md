# 北邮人论坛 · 简约版

Tampermonkey 用户脚本，重做北邮人论坛网页**帖子详情页**。当前版本 **0.5.2**，只作用于 `#!article/...` 帖子页。默认开启，左下角「简约版」或 `Alt+M` 可切回原版。

## 特色功能

- **修正原版问题**：网页缩放后精彩回复不再被裁切。
- **浮动标题 / 路径栏**：顶部向下滚动显示主题，向上滚动显示路径，点击主题回顶。
- **底部快捷回复**：固定在窗口底部。
- **深色模式**：可手动切换或跟随系统。
- **控制条与版面菜单**：取消左侧菜单，左下角切换经典布局，`☰` 打开完整版面菜单。
- **头像即资料入口**：取消`查看`按钮，点击头像可打开用户资料框。


### 其他

- 正文元信息（发信人 / 标题 / 发信站）及 `※ 来源`、`※ 修改` 淡化。
- 分页靠左、发文按钮靠右；楼层徽标移到用户名旁。
- 保留原版全部功能：搜索、关注、分页、分享、回复、收藏、精彩回复、只看此 ID、返回顶部等。

## 安装

**一键安装**：[点此安装](https://raw.githubusercontent.com/Hermi-Mire/byrbbs-minimalist-frontend/main/byrbbs-minimalist-frontend.user.js)（Tampermonkey 会弹出安装页）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击 [`byrbbs-minimalist-frontend.user.js`](byrbbs-minimalist-frontend.user.js) 文件，选择 “Raw” 查看原始内容
3. Tampermonkey 会自动弹出安装提示，点击“安装”即可

或者手动安装：打开 Tampermonkey 控制面板 → 新建脚本 → 粘贴 `byrbbs-minimalist-frontend.user.js` 的全部内容 → 保存。

安装后打开任意帖子详情页，左下角出现「简约版」按钮即生效。

## 注意事项

- 只影响帖子详情页，其他页面不变。
- 依赖站点现有 DOM 和 CSS，站点改版后可能失效；布局异常时按 `Alt+M` 切回经典版。
- 主要在离线页面验证，线上 AJAX 细节可能略有差异。
- 与其他修改版面的用户脚本可能冲突，可暂时停用其中一个。
- 脚本不发起网络请求，不读取或上传账号信息、Cookie、帖子内容，也不会自动发帖 / 回复 / 点赞；只在 `localStorage` 保存 `bym-enabled` / `bym-theme` 两个界面偏好。

## 许可证

[MIT](LICENSE) © 2026 Hermi

## 相关脚本

- [BYR-clear-tool](https://github.com/garrett93722/BYR-clear-tool/)
- [byrbbs-modern-frontend](https://github.com/Hyiker/byrbbs-modern-frontend)
