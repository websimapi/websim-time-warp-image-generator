const { useState, useEffect, useSyncExternalStore } = React;

// --- Websim Setup ---
const room = new WebsimSocket();
const BASE_IMAGE_COLLECTION = 'future_image_base_v2';

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
            <h2>1. Create a New Base Image</h2>
            <p>Generate a new image with AI. It will be added to the public gallery for everyone to use.</p>
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
    return (
        <div className="card">
            <h2>2. Select a Base Image from the Gallery</h2>
            {isLoading && <p>Loading gallery...</p>}
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
             {baseImages.length === 0 && !isLoading && <p>No base images yet. Why not create one?</p>}
        </div>
    );
};

const FutureGenerator = ({ selectedImage }) => {
    const [sliderValue, setSliderValue] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingText, setLoadingText] = useState('');
    const [result, setResult] = useState(null);
    const [isCommenting, setIsCommenting] = useState(false);
    const [isAddingToGallery, setIsAddingToGallery] = useState(false);
    
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

    const handleAddToGallery = async () => {
        if (!result) return;
        setIsAddingToGallery(true);
        try {
            // 1. Fetch the generated image from its temporary URL
            const response = await fetch(result.imageUrl);
            const blob = await response.blob();
            const file = new File([blob], `warped_${Date.now()}.png`, { type: 'image/png' });

            // 2. Upload it to get a persistent URL
            const persistentUrl = await websim.upload(file);

            // 3. Create a new record in the base image gallery
            await room.collection(BASE_IMAGE_COLLECTION).create({
                prompt: result.futureDescription,
                imageUrl: persistentUrl,
            });

            // Provide user feedback
            // A more elegant solution could be a temporary success message on the button
        } catch (error) {
            console.error("Error adding image to gallery:", error);
            alert("Sorry, there was an error adding the image to the gallery.");
        } finally {
            setIsAddingToGallery(false);
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
                        <div className="result-actions">
                            <button 
                                className="btn btn-primary"
                                onClick={handlePostComment}
                                disabled={isCommenting || isAddingToGallery}
                            >
                                {isCommenting ? 'Posting...' : 'Add as Comment'}
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleAddToGallery}
                                disabled={isAddingToGallery || isCommenting}
                            >
                                {isAddingToGallery ? 'Adding...' : 'Add to Gallery'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const App = () => {
    const [selectedImage, setSelectedImage] = useState(null);
    const [isGalleryLoading, setIsGalleryLoading] = useState(true);

    const baseImages = useSyncExternalStore(
        room.collection(BASE_IMAGE_COLLECTION).subscribe,
        room.collection(BASE_IMAGE_COLLECTION).getList
    ) || [];
    
    // Reverse the array so newest images appear first
    const sortedBaseImages = React.useMemo(() => [...baseImages].reverse(), [baseImages]);

    useEffect(() => {
        // A simple way to know when initial data has loaded.
        // getList returns an empty array on first call, then the data.
        if (baseImages.length > 0 || room.collection(BASE_IMAGE_COLLECTION).getList().length === 0) {
            setIsGalleryLoading(false);
        }
    }, [baseImages]);
    
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