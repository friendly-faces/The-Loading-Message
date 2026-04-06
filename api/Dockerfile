FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/api ./...

FROM scratch
COPY --from=build /out/api /app/api
COPY message.json /app/message.json
EXPOSE 8080
ENTRYPOINT ["/app/api"]
