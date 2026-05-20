# nablarch-class-visualizer 起動手順

## 前提
- port 3000: Gitea (占有)
- port 3001: kakeibo (占有)
- **使用ポート: 5000**

## 起動コマンド

```bash
cd ~/nablarch-class-visualizer/viewer
nohup npx serve dist -p 5000 --no-clipboard > /tmp/nablarch-serve.log 2>&1 &
```

## アクセスURL
- WSL内: http://localhost:5000/
- Windowsブラウザ: http://localhost:5000/

## 停止

```bash
pkill -f "serve dist"
```

## ログ確認
```bash
cat /tmp/nablarch-serve.log
```
