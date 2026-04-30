#!/usr/bin/env python3
import urllib.request
import urllib.error
import ssl
import sys
import time

def download_pocketbase():
    url = "https://github.com/pocketbase/pocketbase/releases/download/v0.36.8/pocketbase_0.36.8_macos_amd64.zip"
    output_file = "pocketbase.zip"
    
    # Create SSL context that doesn't verify certificates (for testing)
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    
    print(f"正在下载 PocketBase...")
    print(f"URL: {url}")
    
    try:
        # Try with different user agents
        user_agents = [
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
            'curl/7.64.1'
        ]
        
        for i, user_agent in enumerate(user_agents):
            try:
                print(f"\n尝试 {i+1}/{len(user_agents)}...")
                request = urllib.request.Request(url)
                request.add_header('User-Agent', user_agent)
                
                with urllib.request.urlopen(request, timeout=30, context=context) as response:
                    total_size = int(response.headers.get('content-length', 0))
                    downloaded = 0
                    
                    with open(output_file, 'wb') as f:
                        while True:
                            chunk = response.read(8192)
                            if not chunk:
                                break
                            f.write(chunk)
                            downloaded += len(chunk)
                            
                            if total_size > 0:
                                percent = (downloaded / total_size) * 100
                                print(f"\r下载进度: {percent:.1f}%", end='')
                    
                    print(f"\n✓ 下载完成: {output_file}")
                    return True
                    
            except urllib.error.URLError as e:
                print(f"✗ 失败: {e}")
                if i < len(user_agents) - 1:
                    print("等待 3 秒后重试...")
                    time.sleep(3)
                continue
            except Exception as e:
                print(f"✗ 错误: {e}")
                continue
                
    except Exception as e:
        print(f"✗ 下载失败: {e}")
        return False
    
    return False

if __name__ == "__main__":
    if download_pocketbase():
        print("\n下载成功！")
        sys.exit(0)
    else:
        print("\n下载失败，请检查网络连接或手动下载")
        print("下载地址: https://github.com/pocketbase/pocketbase/releases/download/v0.36.8/pocketbase_0.36.8_macos_amd64.zip")
        sys.exit(1)