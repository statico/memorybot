![cute robot icon](https://statico.github.io/memorybot/icon.png)

# memorybot

## How to use it

Check out the documentation on [https://statico.github.io/memorybot/](https://statico.github.io/memorybot/)

## How to install it

You will have to host and run memorybot yourself. There is no "Add to Slack" button because hosting bots costs money. Also, memorybot needs to listen to all of the chat messages on rooms you invite it to, so you probably don't want to send your Slack team's chat messages to some random server that you don't trust.

### 1. Create a new bot integration for your team

1. Go to [https://my.slack.com/services/new/bot](https://my.slack.com/services/new/bot)
1. Give it a nice name, like `@membot` or `@bender` or `@hal9000` or `@glados`
1. Maybe give it an icon. Check out the [free Robots Expression icons](https://www.iconfinder.com/iconsets/robots-expression) by Graphiqa Stock.
1. Save the API token for later. It should begin with `xoxb-`.

### 2a. Run memorybot with Docker

```
$ mkdir /path/to/data
$ docker run --name memorybot -v /path/to/data:/data -e SLACK_TOKEN=xoxb-xxxxx statico/memorybot
````

### 2b. Run memorybot as a standalone application

```
$ mkdir data
$ npm install
$ echo "SLACK_TOKEN=xob-xxxxx" >.env
$ npm run -s start
```

## Feature requests & bugs?

Please [file a GitHub issue](https://github.com/statico/memorybot/issues) or [create a Pull Request](https://github.com/statico/memorybot/pulls).

## Credits

- [infobot](http://infobot.org/) is a project by kevin lenzo
- [Fun android icon](https://www.iconfinder.com/icons/385841/) by [Graphiqa Stock](https://www.iconfinder.com/graphiqa)
