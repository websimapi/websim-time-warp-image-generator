const { useState, useEffect, useSyncExternalStore, useRef, useMemo } = React;

// --- Websim Setup ---
const room = new WebsimSocket();
const BASE_IMAGE_COLLECTION = 'future_image_base_v2';
const CONTENT_FLAGGED_URL = '/a/8d247dfb-1184-4072-a022-dd3fff7f89b6';

// --- Time Scale Configuration ---
const TIME_RANGES = [
    { max: 7, singular: 'day', plural: 'days', base: 0 }, // 0-7 days
    { max: 21, singular: 'week', plural: 'weeks', base: 7, unit: 7 }, // 1-3 weeks
    { max: 365, singular: 'month', plural: 'months', base: 21, unit: 30 }, // 1-12 months
    { max: 100 * 365, singular: 'year', plural: 'years', base: 365, unit: 365 }, // 1-100 years
    { max: 1000 * 365, singular: 'century', plural: 'centuries', base: 100 * 365, unit: 100 * 365 }, // 1-10 centuries
    { max: 100000 * 365, singular: 'millennium', plural: 'millennia', base: 1000 * 365, unit: 1000 * 365 }, // 1-100 millennia
];
const MAX_SLIDER_VAL = TIME_RANGES.length;

function getTimeLabel(sliderValue) {
    if (sliderValue === 0) return "Present Day";

    const isFuture = sliderValue > 0;
    const absSliderValue = Math.abs(sliderValue);

    const scale = (absSliderValue / MAX_SLIDER_VAL) * (TIME_RANGES.length - 1);
    const rangeIndex = Math.floor(scale);
    const rangeProgress = scale - rangeIndex;

    const range = TIME_RANGES[rangeIndex];
    const rangeSpan = range.max - range.base;
    let days = range.base + (rangeProgress * rangeSpan);

    let value;
    let unit;

    if (range.unit) {
        value = Math.max(1, Math.round(days / range.unit));
        unit = value === 1 ? range.singular : range.plural;
    } else {
        value = Math.round(days);
        unit = value === 1 ? range.singular : range.plural;
    }

    if (isFuture) {
        return `${value} ${unit} into the future`;
    } else {
        return `${value} ${unit} into the past`;
    }
}


// --- React Components ---

const Spinner = ({ text }) => (
    <div className="loading-overlay">
        <div className="spinner"></div>
        {text && <p>{text}</p>}
    </div>
);

const ImageUploader = ({ onUploadStart, onUploadEnd }) => {
    const [file, setFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [prompt, setPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = React.useRef(null);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            if (selectedFile.size > 5 * 1024 * 1024) { // 5MB limit
                alert("File is too large. Please select an image under 5MB.");
                return;
            }
            setFile(selectedFile);
            const reader = new FileReader();
            reader.onload = (event) => {
                setPreviewUrl(event.target.result);
            };
            reader.readAsDataURL(selectedFile);
        }
    };

    const handleUpload = async () => {
        if (!file || !prompt.trim()) {
            alert("Please select a file and provide a description.");
            return;
        }
        setIsLoading(true);
        onUploadStart();
        try {
            const persistentUrl = await websim.upload(file);
            
            if (persistentUrl === CONTENT_FLAGGED_URL) {
                alert("The uploaded image was flagged for content moderation and cannot be added to the gallery.");
                setIsLoading(false);
                onUploadEnd();
                return;
            }

            await room.collection(BASE_IMAGE_COLLECTION).create({
                prompt: prompt,
                imageUrl: persistentUrl,
            });
            // Reset form
            setFile(null);
            setPreviewUrl(null);
            setPrompt('');
            if(fileInputRef.current) {
                fileInputRef.current.value = null;
            }
        } catch (error) {
            console.error("Error uploading image:", error);
            alert("Sorry, something went wrong while uploading the image. Please try again.");
        } finally {
            setIsLoading(false);
            onUploadEnd();
        }
    };

    return (
        <div className="card">
            <h2>1. Upload Your Own Base Image</h2>
            <p>Upload an image from your device. It will be added to the public gallery for everyone to warp.</p>
            <div className="upload-area">
                <div className="file-input-wrapper">
                     <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
                        Choose Image
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png, image/jpeg, image/webp"
                        onChange={handleFileChange}
                        disabled={isLoading}
                    />
                </div>

                {previewUrl && (
                    <div className="upload-controls">
                        <img src={previewUrl} alt="Image preview" className="image-preview" />
                         <input
                            type="text"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Describe your image (e.g., 'A photo of my dog')"
                            disabled={isLoading}
                        />
                        <button onClick={handleUpload} className="btn btn-primary" disabled={isLoading || !file || !prompt.trim()}>
                            {isLoading ? 'Uploading...' : 'Upload & Add to Gallery'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const BaseImageGenerator = ({ onGenerationStart, onGenerationEnd }) => {
    const [prompt, setPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleGenerate = async () => {
        if (!prompt.trim()) return;
        setIsLoading(true);
        onGenerationStart();
        try {
            // 1. Generate image from prompt
            const genResult = await websim.imageGen({ prompt, aspect_ratio: "1:1" });

            if (genResult.url === CONTENT_FLAGGED_URL) {
                alert("The generated image was flagged for content moderation and cannot be used.");
                setIsLoading(false);
                onGenerationEnd();
                return;
            }
            
            // 2. We need to upload it to get a persistent URL
            // To do that, we first fetch the generated image as a blob
            const response = await fetch(genResult.url);
            const blob = await response.blob();
            const file = new File([blob], `${prompt.slice(0, 20).replace(/ /g, '_')}.png`, { type: 'image/png' });

            // 3. Upload the file to websim's persistent storage
            const persistentUrl = await websim.upload(file);

            // 4. Create a record in the database
            await room.collection(BASE_IMAGE_COLLECTION).create({
                prompt: prompt,
                imageUrl: persistentUrl,
            });

            setPrompt('');
        } catch (error) {
            console.error("Error generating base image:", error);
            alert("Sorry, something went wrong while creating the base image. Please try again.");
        } finally {
            setIsLoading(false);
            onGenerationEnd();
        }
    };

    return (
        <div className="card">
            <h2>1. Generate a Base Image</h2>
            <p>Generate a new image with AI. It will be added to the public gallery for everyone to warp.</p>
            <div className="input-group">
                <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g., A futuristic city skyline at sunset"
                    disabled={isLoading}
                />
                <button onClick={handleGenerate} className="btn btn-primary" disabled={isLoading || !prompt.trim()}>
                    {isLoading ? 'Generating...' : 'Generate'}
                </button>
            </div>
        </div>
    );
};

const BaseImageGallery = ({ baseImages, onSelect, selectedImage, isLoading }) => {
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef(null);

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelected = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) { // 5MB limit
            alert("File is too large. Please select an image under 5MB.");
            return;
        }

        setIsUploading(true);
        try {
            // 1. Upload the file to get a persistent URL
            const persistentUrl = await websim.upload(file);

            if (persistentUrl === CONTENT_FLAGGED_URL) {
                alert("The uploaded image was flagged for content moderation and cannot be added to the gallery.");
                setIsUploading(false);
                if (fileInputRef.current) {
                    fileInputRef.current.value = null;
                }
                return;
            }
            
            // 2. Have AI generate a prompt for the image
            const imageResponse = await fetch(persistentUrl);
            const imageBlob = await imageResponse.blob();
            const reader = new FileReader();
            const imageDataUrl = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(imageBlob);
            });
            
            const descriptionCompletion = await websim.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are an expert at describing images for an AI image generator. Describe the main subject, style, and composition of the image. Be concise. Your output will be used as a prompt. Do not use conversational language."
                    },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Describe this image." },
                            { type: "image_url", image_url: { url: imageDataUrl } }
                        ]
                    }
                ]
            });
            const generatedPrompt = descriptionCompletion.content || "User uploaded image";

            // 3. Create the record in the database
            await room.collection(BASE_IMAGE_COLLECTION).create({
                prompt: generatedPrompt,
                imageUrl: persistentUrl,
            });

        } catch (error) {
            console.error("Error handling uploaded image:", error);
            alert("Sorry, something went wrong while adding your image to the gallery.");
        } finally {
            setIsUploading(false);
            // Reset file input to allow uploading the same file again
            if (fileInputRef.current) {
                fileInputRef.current.value = null;
            }
        }
    };
    
    return (
        <div className="card">
            <div className="gallery-header">
                <h2>2. Select a Base Image</h2>
                <button className="btn-icon" onClick={handleUploadClick} disabled={isUploading || isLoading} title="Upload your own image">
                    {isUploading ? '...' : '+'}
                </button>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelected}
                    style={{ display: 'none' }}
                    accept="image/png, image/jpeg, image/webp"
                    disabled={isUploading}
                />
            </div>
            <p>Select an image from the public gallery, or upload your own by clicking the `+` button.</p>

            {isLoading && !isUploading && <p>Loading gallery...</p>}
            {isUploading && <p>Adding your image to the gallery...</p>}

            <div className="gallery">
                {baseImages.map(image => (
                    <div
                        key={image.id}
                        className={`gallery-item ${selectedImage?.id === image.id ? 'selected' : ''}`}
                        onClick={() => onSelect(image)}
                    >
                        <img src={image.imageUrl} alt={image.prompt} />
                    </div>
                ))}
            </div>
             {baseImages.length === 0 && !isLoading && !isUploading && <p>No base images yet. Why not create or upload one?</p>}
        </div>
    );
};

const FutureGenerator = ({ selectedImage }) => {
    const [sliderValue, setSliderValue] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingText, setLoadingText] = useState('');
    const [result, setResult] = useState(null);
    const [isCommenting, setIsCommenting] = useState(false);
    
    useEffect(() => {
        // Reset when a new image is selected
        setResult(null);
        setSliderValue(0);
    }, [selectedImage]);

    const handlePostComment = async () => {
        if (!result || !selectedImage) return;
        setIsCommenting(true);
        try {
            const commentContent = `I warped this image ${result.timeJump}!\n\nAI's vision:\n${result.futureDescription}`;
            const postResult = await window.websim.postComment({
                content: commentContent,
                images: [selectedImage.imageUrl, result.imageUrl]
            });

            if (postResult && postResult.error) {
                alert(`Error posting comment: ${postResult.error}`);
            } else {
                // You could add a more visible success message here if desired
                console.log("Comment posted successfully");
            }
        } catch (error) {
            console.error("Error posting comment:", error);
            alert("An unexpected error occurred while posting the comment.");
        } finally {
            setIsCommenting(false);
        }
    };

    const handleGenerateFuture = async () => {
        if (!selectedImage) return;
        
        setIsLoading(true);
        setResult(null);
        setLoadingText("Generating image..."); // Simplified loading message

        try {
            const timeJump = getTimeLabel(sliderValue);
            
            // Step 1: Analyze the base image
            
            // Fetch the image and convert it to a base64 data URL
            const imageResponse = await fetch(selectedImage.imageUrl);
            const imageBlob = await imageResponse.blob();
            const reader = new FileReader();
            const imageDataUrl = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(imageBlob);
            });

            const descriptionCompletion = await websim.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are an expert at describing images in vivid detail. Focus on objects, composition, colors, lighting, and overall mood. Keep your description concise and under 200 words."
                    },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Describe this image in detail." },
                            { type: "image_url", image_url: { url: imageDataUrl } }
                        ]
                    }
                ]
            });
            const baseDescription = descriptionCompletion.content;

            // Step 2: Create the "future" description
            const futureDescCompletion = await websim.chat.completions.create({
                 messages: [
                    {
                        role: "system",
                        content: "You are an AI expert in visual transformation over time. Your task is to rewrite an image description to reflect the passage of a specified amount of time, either forward (future) or backward (past). You must only output the new, detailed image description. Do NOT include any conversational text, introductions, or explanations like 'Here is the new description...'. The output should be a direct, high-quality prompt for an AI image generator."
                    },
                    {
                        role: "user",
                        content: `The original image description is: '${baseDescription}'. The user wants to see what this scene looked like ${timeJump}. Rewrite the description to reflect this time shift. If going to the past, imagine what the scene's components looked like before (e.g., newer, less weathered, under construction, different technology). If going to the future, describe natural changes (e.g., decay, growth, erosion, technological evolution). Start with the core elements of the original description and build upon them with the changes.`
                    }
                ]
            });
            const futureDescription = futureDescCompletion.content;

            // Step 3: Generate the final image
            const finalImageResult = await websim.imageGen({
                prompt: futureDescription,
                aspect_ratio: "1:1"
            });
            
            if (finalImageResult.url === CONTENT_FLAGGED_URL) {
                alert("The generated time-warped image was flagged for content moderation.");
                setIsLoading(false);
                setLoadingText('');
                return;
            }

            setResult({
                imageUrl: finalImageResult.url,
                baseDescription,
                futureDescription,
                timeJump: timeJump
            });

        } catch (error) {
            console.error("Error generating future image:", error);
            alert("Sorry, an error occurred during the future generation process. Please try again.");
        } finally {
            setIsLoading(false);
            setLoadingText('');
        }
    };

    if (!selectedImage) {
        return (
            <div className="card">
                <div className="placeholder-text">Select a base image above to begin.</div>
            </div>
        );
    }

    return (
        <div className="card">
            <h2>3. Travel to the Future</h2>
            <div className="generator-container">
                <div className="image-display">
                     <img src={selectedImage.imageUrl} alt={selectedImage.prompt} />
                </div>
                <div className="controls">
                    <div className="slider-container">
                         <h3>Select a time jump:</h3>
                         <input 
                            type="range"
                            min={-MAX_SLIDER_VAL}
                            max={MAX_SLIDER_VAL}
                            step="0.01"
                            value={sliderValue}
                            onChange={(e) => setSliderValue(parseFloat(e.target.value))}
                         />
                         <div id="time-label">{getTimeLabel(sliderValue)}</div>
                    </div>
                    <button 
                        className="btn btn-primary btn-large" 
                        onClick={handleGenerateFuture}
                        disabled={isLoading || sliderValue === 0}
                    >
                        {isLoading ? 'Generating...' : 'Generate Image'}
                    </button>
                </div>
            </div>
            
            {isLoading && <Spinner text={loadingText} />}

            {result && (
                <div className="results-container">
                    <div className="result-image-display image-display">
                        <img src={result.imageUrl} alt="Generated future image" />
                    </div>
                    <div className="result-text">
                        <h4>{`AI's Vision of ${result.timeJump}:`}</h4>
                        <p>{result.futureDescription}</p>
                        <button 
                            className="btn btn-primary"
                            onClick={handlePostComment}
                            disabled={isCommenting}
                        >
                            {isCommenting ? 'Posting...' : 'Add as Comment'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const App = () => {
    const [selectedImage, setSelectedImage] = useState(null);
    const [isGalleryLoading, setIsGalleryLoading] = useState(true);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);

    const baseImages = useSyncExternalStore(
        room.collection(BASE_IMAGE_COLLECTION).subscribe,
        () => {
            const list = room.collection(BASE_IMAGE_COLLECTION).getList();
            // This is a special value that getList can return on the very first, synchronous call,
            // before the connection is established. It helps distinguish "connecting" from "connected and empty".
            if (list === undefined) {
                return undefined;
            }
            // Once we get a list (even an empty one), we know the initial load has happened.
            if (!initialLoadComplete) {
                setInitialLoadComplete(true);
            }
            return list || [];
        }
    );
    
    // This effect runs once when the user's data is available and checks for flagged images they own.
    useEffect(() => {
        if (!baseImages) return;

        const checkMyImages = async () => {
            const currentUser = await websim.getCurrentUser();
            if (!currentUser) return;

            const myFlaggedImages = baseImages.filter(img => 
                img.username === currentUser.username && 
                img.imageUrl === CONTENT_FLAGGED_URL
            );
            
            if (myFlaggedImages.length > 0) {
                console.log(`Found ${myFlaggedImages.length} flagged images to remove for user ${currentUser.username}.`);
                // Use Promise.all to delete them concurrently
                await Promise.all(
                    myFlaggedImages.map(img => room.collection(BASE_IMAGE_COLLECTION).delete(img.id))
                ).catch(err => {
                    console.error("Error during batch deletion of flagged images:", err);
                });
            }
        };

        checkMyImages();
    }, [baseImages]);

    // Reverse the array so newest images appear first
    const sortedBaseImages = React.useMemo(() => {
        if (!baseImages) return [];
        // Also filter out any flagged images from the view immediately
        return [...baseImages].filter(img => img.imageUrl !== CONTENT_FLAGGED_URL).reverse();
    }, [baseImages]);

    useEffect(() => {
        // Hide the loader once we know the first data fetch is done.
        if (initialLoadComplete) {
            setIsGalleryLoading(false);
        }
    }, [initialLoadComplete]);
    
    return (
        <>
            <h1>Time Warp Image Generator</h1>
            <p className="sub-header">Let's do the time warp AGAIN!</p>
            <BaseImageGenerator onGenerationStart={() => {}} onGenerationEnd={() => {}} />
            <BaseImageGallery 
                baseImages={sortedBaseImages} 
                selectedImage={selectedImage}
                onSelect={setSelectedImage}
                isLoading={isGalleryLoading}
            />
            <FutureGenerator selectedImage={selectedImage} />
        </>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);