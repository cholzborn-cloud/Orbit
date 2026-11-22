#import <Foundation/Foundation.h>
#import <NaturalLanguage/NaturalLanguage.h>
#include "sherpa-onnx/c-api/c-api.h"

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 3) return 2;
        NSData *input = [[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];
        NSString *text = [[NSString alloc] initWithData:input encoding:NSUTF8StringEncoding];
        if (!text.length || text.length > 8000) return 2;

        NLLanguageRecognizer *recognizer = [NLLanguageRecognizer new];
        recognizer.languageConstraints = @[NLLanguageGerman, NLLanguageEnglish];
        [recognizer processString:text];
        NSString *language = [recognizer.dominantLanguage isEqualToString:NLLanguageEnglish] ? @"en" : @"de";
        NSString *root = [NSString stringWithUTF8String:argv[1]];
        NSString *voice = [root stringByAppendingPathComponent:language];
        SherpaOnnxOfflineTtsConfig config = {0};
        config.model.vits.model = [voice stringByAppendingPathComponent:@"model.onnx"].fileSystemRepresentation;
        config.model.vits.tokens = [voice stringByAppendingPathComponent:@"tokens.txt"].fileSystemRepresentation;
        config.model.vits.data_dir = [root stringByAppendingPathComponent:@"espeak-ng-data"].fileSystemRepresentation;
        config.model.num_threads = 2;
        config.model.provider = "cpu";
        config.max_num_sentences = 1;
        const SherpaOnnxOfflineTts *tts = SherpaOnnxCreateOfflineTts(&config);
        if (!tts) return 1;
        SherpaOnnxGenerationConfig generation = {0};
        generation.speed = 1.0;
        const SherpaOnnxGeneratedAudio *audio = SherpaOnnxOfflineTtsGenerateWithConfig(
            tts, text.UTF8String, &generation, NULL, NULL);
        BOOL ok = audio && audio->n > 0 && SherpaOnnxWriteWave(audio->samples, audio->n, audio->sample_rate, argv[2]);
        if (audio) SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio);
        SherpaOnnxDestroyOfflineTts(tts);
        return ok ? 0 : 1;
    }
}
