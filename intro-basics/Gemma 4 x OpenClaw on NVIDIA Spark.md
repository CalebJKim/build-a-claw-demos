---
title: Gemma 4 x OpenClaw on NVIDIA Spark

---

# Gemma 4 x OpenClaw on NVIDIA Spark

## Llama.cpp x Openclaw manual setup


You can install Gemma 4 and llama.cpp locally to run the model.

Here are the ways to setup the serving side and then Openclaw
```
#based on this https://unsloth.ai/docs/models/gemma-4

sudo apt-get update
sudo apt-get install pciutils build-essential cmake curl libcurl4-openssl-dev -y

git clone https://github.com/ggml-org/llama.cpp

#latest from 5/4
git -C llama.cpp checkout b97ebdc98f6053604a19d861c08d8087601b96e0

#or try version on 4/26 tested by Ray -- works ok
#git -C llama.cpp checkout 5594d132244aeb1bae54dd431e7efbc908f5e3b8

cmake llama.cpp -B llama.cpp/build \
    -DBUILD_SHARED_LIBS=OFF -DGGML_CUDA=ON

cmake --build llama.cpp/build --config Release -j --clean-first --target llama-cli llama-mtmd-cli llama-server llama-gguf-split

cp llama.cpp/build/bin/llama-* llama.cpp

```

Download the model

```
#install HF transfer if you don't have it
python3 -m venv venv
source venv/bin/activate
pip install huggingface_hub hf_transfer

hf download unsloth/gemma-4-26B-A4B-it-GGUF \
    --local-dir unsloth/gemma-4-26B-A4B-it-GGUF \
    --include "*mmproj-BF16*" \
    --include "*UD-Q4_K_XL*" # Use "*UD-Q2_K_XL*" for Dynamic 2bit
```

Serving the model. DO NOT CLOSE THIS TERMINAL! Keep this terminal open the entire time for all demos (and use it as debug screen). 
```
./llama.cpp/llama-server \
    --model unsloth/gemma-4-26B-A4B-it-GGUF/gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf \
    --mmproj unsloth/gemma-4-26B-A4B-it-GGUF/mmproj-BF16.gguf \
    --temp 1.0 \
    --top-p 0.95 \
    --top-k 64 \
    --alias "unsloth/gemma-4-26B-A4B-it-GGUF" \
    --port 8000 \
    --cache-ram 0 --ctx-checkpoints 1
    --chat-template-kwargs '{"enable_thinking":true}'
```

On another terminal, you can test the llama-server making sure it will response.
```
curl http://127.0.0.1:8000/v1/chat/completions   -H "Content-Type: application/json"   -d '{
    "model": "gemma4:26b",
    "messages": [
      { "role": "user", "content": "Hi" }
    ]
  }'

```
A few known issues:

1. The cache-ram and ctx checkpoints will burn the ram, make sure you add these, because unsloth didn't document either. (reported on 4/6/2026)
https://www.reddit.com/r/LocalLLaMA/comments/1sdqvbd/comment/oekiv3j/
https://www.reddit.com/r/openclaw/comments/1sb3ezf/ollamagemma4_is_completely_useless_for_openclaw/

Also, we should experiment with the RAM size and checkpoints to see if we can get any performance gain. 
```
    --cache-ram 2048 --ctx-checkpoints 2
```

2. Ollama seems to always quit early or never finish the tasks when it's long. Tool calling seems to be broken, and was patched in 0.20.3 but still not good enough for Openclaw demo. Please check before switching to Ollama.



## Install Openclaw

```
curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard

#if you have version too new you can install with this
#to avoid demo failure that's been tested
npm install -g openclaw@2026.5.7

```


Now the part we need is to use vllm as the model serving and then point to it. You can use the openclaw onboard interface, follow through the vllms setup. 

```
openclaw onboard --install-daemon
```

And the most important part is setting up the vLLM as providers, and here is an example screenshot.
![Screenshot from 2026-04-13 13-05-13](https://hackmd.io/_uploads/rkRqhpc2Wx.png)


You can use this openclaw.json file as reference setup:

```
{
  "agents": {
    "defaults": {
      "timeoutSeconds": 300,
      "model": {
        "primary": "vllm/unsloth/gemma-4-26B-A4B-it-GGUF"
      },
      "workspace": "/home/raymondlo84/.openclaw/workspace",
      "models": {
        "vllm/unsloth/gemma-4-26B-A4B-it-GGUF": {}
      }
    }
  },
  ...
  
      "vllm": {
        "baseUrl": "http://127.0.0.1:8000/v1",
        "api": "openai-completions",
        "apiKey": "VLLM_API_KEY",
        "models": [
          {
            "id": "unsloth/gemma-4-26B-A4B-it-GGUF",
            "name": "unsloth/gemma-4-26B-A4B-it-GGUF",
            "reasoning": true,
            "input": [
              "text", "image"
            ],
            "cost": {
              "input": 0,
              "output": 0,
              "cacheRead": 0,
              "cacheWrite": 0
            },
            "contextWindow": 128000,
            "maxTokens": 16000
          }
        ]
      }
    }
 ...
```


### Web Search Skill

#### Ollama Web Search
And lastly ensure you enable the tools needed for demo, and in my case I used ollama web search:

https://docs.ollama.com/integrations/openclaw

```
curl -fsSL https://ollama.com/install.sh | sh
openclaw plugins install @ollama/openclaw-web-search
ollama login

#restart gateway before trying the demo
openclaw gateway restart

#run to open the browser interface
openclaw dashboard
```
![image](https://hackmd.io/_uploads/rk65i8mn-l.png)

#### Brave Web Search

Alternatively, you can use Brave Search API:

You can get the $5 credit (1000 request per month) for free, and then after that we can pay for subscriptions

https://brave.com/search/api/guides/use-with-openclaw/

https://docs.openclaw.ai/tools/brave-search

And you can use this command to configure the API keys and all.
```
openclaw configure --section web
```




## Really fun prompts

#### 1. Make a pong game and save it on desktop

```
can you write a html app that have a pong game, save it on Desktop with pong
```
![image](https://hackmd.io/_uploads/rkRkzDQ3Wx.png)


#### 2. Get the latest event information and plan for you!

```
ok, now do a full research and find all source code around openclaw, find the painpoints, and save them at the Desktop openclaw-pain folder. (Document in both English and Korean)
```


#### 3. Upgrade the pong game, and make it better!

![image](https://hackmd.io/_uploads/Hyu_svmhbe.png)

```
Ok, read the pong file on my Desktop, and refine and make it better 10x! and make it exciting. Save the results back on Desktop and report back to me.
```

This prompt may fail depends if you have approved the sessions (when it ask for spawn): Run the following command to approve them before re-running it.

```
openclaw devices approve
```
![Neon-Cyber-Pong-04-07-2026_10_49_PM](https://hackmd.io/_uploads/H1XA2wQn-g.jpg)

#### 4. Email your game to your friends

1. Setup Agentmail 

Create an account https://.agentmail.to, and then create an inbox.


```
npx clawhub@latest install agentmail
@BUG skip the .openclaw.json setup and place key inside the .openclaw/workspace/.env file instead
#Get the API Key, save it in .env file under .openclaw directory

#then restart gateway

openclaw gateway restart
#When you are ready, prompt in the chat to setup your email address before asking to send email.
```

Talk to chatbot in Openclaw and give it the instructions
```
Your email address is raymond-nvidia@agent.to
You have access to AgentMail — an Email API for Agents.
The llms.txt file is a very good starting point. Read it first, then go from there based on what the user needs.

llms.txt (overview + all doc links): https://docs.agentmail.to/llms.txt
llms-full.txt (complete reference with inline code examples): https://docs.agentmail.to/llms-full.txt


```
![image](https://hackmd.io/_uploads/HJU98lU3be.png)

![Screenshot 2026-04-08 at 1.15.01 PM](https://hackmd.io/_uploads/HJtIPVVhZe.png)

![image](https://hackmd.io/_uploads/r1e0O4V2Wg.png)


#### Mario inspired like games

![ezgif-6308e0899a999740](https://hackmd.io/_uploads/B1NAbOan-x.gif)

```
build mario inspired game in HTML, and make sure it got physics
```

And you can keep improving it by asking it to improve it continuously with some features.


```
add lots of details including hands, arms, legs, and more eyes to the character
```


![ezgif-6575d5bc1c1b972d](https://hackmd.io/_uploads/H1ZiLOT2-g.gif)



#### Enable VLM! 

You can enable VLM by modifying the `openclaw.json`. You need to add "image" as part of the input.

```
"vllm": {
        "baseUrl": "http://127.0.0.1:8001/v1",
        "api": "openai-completions",
        "apiKey": "VLLM_API_KEY",
        "models": [
          {
            "id": "unsloth/gemma-4-26B-A4B-it-GGUF",
            "name": "unsloth/gemma-4-26B-A4B-it-GGUF",
            "reasoning": false,
            "input": [
              "text", "image"
            ],
            "cost": {
              "input": 0,
              "output": 0,
              "cacheRead": 0,
              "cacheWrite": 0
            },
            "contextWindow": 128000,
            "maxTokens": 8192
          }
        ]
      }

```

![image](https://hackmd.io/_uploads/HJXyXt3TZl.png)
![image](https://hackmd.io/_uploads/SJ2SmYha-e.png)

And you can connect this to webcam with fswebcam with (`apt-get install fswebcam`). Then, you can setup a prompt or instruction to do something like a cron job with webcam easily with the VLM.

![image](https://hackmd.io/_uploads/Skze3E6Tbg.png)

### Isaac Sim/Lab (Advanced demo)

You can first ask Openclaw to read the documentations, and once it's ready you can ask it to build the simple hello world cube demo, and go from there. Do not ask for impossibly difficult scene as most likely it will fail! Try incrementally guide it to complete the goal.

![image](https://hackmd.io/_uploads/Byvp4iAT-g.png)

<iframe width="560" height="315" src="https://www.youtube.com/embed/9zf2GoPuoQo?si=WvketdXAyW9CMV2X" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>


## Why Spark? (It is the memory!)

I tried replicating the work on 4090 gaming laptop with 16GB of RAM.

```
total duration:       34.325503076s
load duration:        210.405505ms
prompt eval count:    37 token(s)
prompt eval duration: 97.262906ms
prompt eval rate:     380.41 tokens/s
eval count:           1006 token(s)
eval duration:        33.390665306s
eval rate:            30.13 tokens/s
```
I'm getting about 1/2 of the token rate, mainly due to the model cannot fit to the memory as you can see in the 24/76% ratio below.
```
NAME          ID              SIZE     PROCESSOR          CONTEXT    UNTIL              
gemma4:26b    5571076f3d70    19 GB    24%/76% CPU/GPU    4096       4 minutes from now  
```
And with nemotron-3-super, it's completely out of memory and thus not be able to run at all. 
```
(base) nvidia@nvidia-Stealth-17Studio-A13VI:~/.openclaw$ ollama run nemotron-3-super
Error: 500 Internal Server Error: model requires more system memory (72.4 GiB) than is available (58.3 GiB)
```

You may need up to RTX PRO 6000 to have the model running well, and this makes Spark and attractive option to people who would like to tinker. (And relatively great performance for the power usage).

## Models to Try Next

The next great candidate for model to try is Nemotron-3-super:120b! You can go through either the official documentation, 

https://build.nvidia.com/spark/nemoclaw 
or

Give this a read of how I setup with Ollama with a few lines of code with Ollama as provider. Warning: please backup ~/.openclaw/openclaw.json file to keep your vllm settings. 

https://hackmd.io/@raymondlo84/B1SAV37qZg

Lastly, you can use openrouter to get Nemotron-3-super cloud side. 
https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b

To run on Spark, please first make sure you have provided the correct permissions for the ollama via docker.


```
sudo usermod -aG docker $USER
newgrp docker
```

Then you can do a quick install of the latest Ollama.

```
curl -fsSL https://ollama.com/install.sh | sh

#run nemotron-3-super model 120b
ollama run nemotron-3-super:120b --verbose

```

That script above will provide a simple chatbot interface on terminal and you can see it in action. 

```
ollama ps
```

Also, make sure you check the model is running 100% on GPU. If there are any issues. Try repeating steps here and debug:

https://build.nvidia.com/spark/open-webui/sync

When the model is all ready. Now you can run this command to switch the primary/default model.

```
openclaw models set ollama/nemotron-3-super:120b
openclaw gateway restart
```

You should be able to see the new model in the list of available models at Openclaw. And you can revert it back to Gemma4 with this command.

```
openclaw models set vllm/unsloth/gemma-4-26B-A4B-it-GGUF
openclaw gateway restart
```


## Known Issues:


```
common_chat_try_specialized_template: detected an outdated gemma4 chat template, applying compatibility workarounds. Consider updating to the official template.

Solution:
https://www.reddit.com/r/LocalLLaMA/comments/1shbqmx/psa_gemma_4_template_improvements/

Hopefully the ggml-org GGUFs will be rebuilt with the new template, but for now
you can download just the newer template with
hf download google/gemma-4-26B-A4B-it chat_template.jinja
and then refer to
~/.cache/huggingface/hub/models--google--gemma-4-26B-A4B-it/snapshots/1db3cff1840c2ae59759d8e842ff37831cf8cb63/chat_template.jinja
with the --chat-template-file option.

```