# 校园阴凉路线实验室

在真实校园布局上比较步行路线、模拟日晒，并试验不同预算下的遮阴改造。

[在线演示](https://campus-shade-lab-261114.fyyangtyliu.chatgpt.site/)

## 本地运行

在仓库目录运行以下命令，然后打开 [http://localhost:8000](http://localhost:8000)。

```sh
python3 -m http.server 8000 --directory dist
```

静态资源都在 `dist/`。无需安装项目依赖。3D 漫游使用 WebGL，页面也提供平面地图。

- 路线：设置起点、终点、时间和照度，选择推荐路线，或自己指定途经路口。
- 演示：点「开始走路线」让角色自动行走，可切换观察视角或进入第一人称。地图会显示角色所在位置的模拟日晒和遮阴状态。
- 遮阴改造：在地图或三维场景上放置树木、盆栽和凉亭。输入预算上限，查看预计费用、余额和改造前后的遮阴覆盖。

## 示例数据

伯克利示例使用 [USDA NAIP 航拍影像](https://planetarycomputer.microsoft.com/dataset/naip)，并参考[伯克利校方校园地图](https://www.berkeley.edu/map/)。建筑外形与高度为重建估值，遮阴比例及费用用于演示。
