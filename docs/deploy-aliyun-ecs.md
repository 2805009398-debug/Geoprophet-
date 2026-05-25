# GeoProphet 阿里云 ECS 部署

本文档适用于把当前项目正式部署到阿里云 ECS。

## 方案选择

- 先快速上线：使用 `docker-compose.prod.yml`，通过 ECS 公网 IP 访问，站点为 HTTP。
- 正式域名上线：使用 `docker-compose.https.yml`，由 Caddy 自动申请和续期 HTTPS 证书。

## 阿里云侧准备

1. 准备一台 ECS。
   - 建议镜像：`Ubuntu 24.04 LTS` 或 `Ubuntu 22.04 LTS`
   - 建议规格：`2 vCPU / 2 GiB` 起步
   - 需要绑定公网 IP
2. 配置安全组入方向规则。
   - `22/TCP`：仅你的办公 IP 或家庭宽带 IP
   - `80/TCP`：`0.0.0.0/0`
   - `443/TCP`：`0.0.0.0/0`
3. 如果要启用 HTTPS，准备一个域名，并把 A 记录解析到 ECS 公网 IP。

## 服务器初始化

通过 SSH 登录 ECS 后执行：

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

## 上传项目

二选一：

1. 已经有 Git 仓库：

```bash
git clone <your-repo-url> /opt/geoprophet
cd /opt/geoprophet
```

2. 还没有远程仓库：
   - 把当前 `hicool` 项目打包上传到 ECS，例如上传到 `/opt/geoprophet`
   - 上传后进入目录：`cd /opt/geoprophet`

## 生产配置

复制环境变量模板：

```bash
cp .env.production.example .env.production
```

编辑 `.env.production`：

```dotenv
JWT_SECRET=替换成至少32位的随机字符串
WEB_PORT=80
APP_DOMAIN=your-domain.com
```

说明：

- `JWT_SECRET` 必须修改，不能继续使用演示密钥。
- 如果你暂时没有域名，`APP_DOMAIN` 可以先随便填，但不要使用 HTTPS 方案启动。

## 启动方式

### 方式一：先用公网 IP 上线

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

验证：

```bash
docker compose -f docker-compose.prod.yml ps
curl http://127.0.0.1/api/health
```

公网访问：

```text
http://ECS公网IP
```

### 方式二：域名 + HTTPS 正式上线

前提：

- 域名 A 记录已经指向 ECS 公网 IP
- 安全组已放通 `80` 和 `443`

启动：

```bash
docker compose --env-file .env.production -f docker-compose.https.yml up -d --build
```

验证：

```bash
docker compose -f docker-compose.https.yml ps
curl http://127.0.0.1/api/health
```

公网访问：

```text
https://your-domain.com
```

## 常用运维命令

查看日志：

```bash
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.https.yml logs -f
```

重启：

```bash
docker compose -f docker-compose.prod.yml restart
docker compose -f docker-compose.https.yml restart
```

拉起新版本：

```bash
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

或：

```bash
git pull
docker compose --env-file .env.production -f docker-compose.https.yml up -d --build
```

## 上线后检查项

- 打开首页能正常加载图表与列表
- 使用 `admin / admin123` 能正常登录
- 群众上报图片上传正常
- `backend/data` 和 `backend/uploads` 在宿主机上持续存在
- 服务器重启后容器可自动拉起
